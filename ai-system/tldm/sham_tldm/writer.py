"""Diffusion Writer: a whole block of `block` tokens is written in `steps` passes (the report: 128 tokens in 10 steps, not 128 runs).
Training: random positions of the target block are hidden and the writer predicts them from the visible ones and the latents (masked discrete diffusion).
Generation: start with everything hidden; each pass fills in the most confident hidden positions; the last pass fills the rest."""
import torch
import torch.nn as nn
import torch.nn.functional as F


class DiffusionWriter(nn.Module):
    def __init__(self, d: int, block: int, vocab: int = 257, layers: int = 3, heads: int = 4, embed: nn.Module | None = None, head: nn.Module | None = None):
        super().__init__()
        self.block = block
        self.embed = embed if embed is not None else nn.Embedding(vocab, d)
        self.head = head if head is not None else nn.Linear(d, vocab, bias=False)
        self.pos = nn.Embedding(block, d)
        self.mask_emb = nn.Parameter(torch.zeros(d))
        self.layers = nn.ModuleList(nn.TransformerDecoderLayer(d, heads, 4 * d, dropout=0.0, batch_first=True, norm_first=True) for _ in range(layers))
        self.norm = nn.LayerNorm(d)
        # Direct additive latent conditioning. Cross-attention alone let the
        # writer settle on the byte/position prior: the run-44696091074 head
        # produced one identical command for all 26 held-out prompts. The
        # latent summary is added to every position embedding AND to the output
        # logits, so the argmax is forced to depend on the latent and cannot be
        # satisfied by the prior alone. cond_logits starts at zero, so training
        # begins from the previous behaviour and learns the dependence.
        self.cond = nn.Sequential(nn.Linear(2 * d, d), nn.SiLU(), nn.Linear(d, d))
        self.cond_logits = nn.Linear(d, vocab, bias=False)
        nn.init.zeros_(self.cond_logits.weight)

    def conditioning(self, z):
        """Pool the latent block into one prompt vector (mean + spread)."""
        mean = z.mean(dim=1)
        std = z.std(dim=1, unbiased=False) if z.shape[1] > 1 else torch.zeros_like(mean)
        return self.cond(torch.cat([mean, std.to(mean.dtype)], dim=-1))

    def logits(self, tokens, masked, z):
        cond = self.conditioning(z)
        x = self.embed(tokens)
        x = torch.where(masked[..., None], self.mask_emb.to(x.dtype).expand_as(x), x) + self.pos(torch.arange(self.block, device=x.device))
        x = x + cond.to(x.dtype)[:, None, :]
        for layer in self.layers:
            x = layer(x, z)
        out = self.head(self.norm(x))
        return out + self.cond_logits(cond.to(out.dtype))[:, None, :]

    def loss(self, z, target, valid_mask=None):   # target (B, block); valid_mask selects bytes + EOS, not padding
        if target.ndim != 2 or target.shape[1] != self.block:
            raise ValueError(f"target must have shape (B,{self.block})")
        if valid_mask is None:
            valid_mask = torch.ones_like(target, dtype=torch.bool)
        else:
            valid_mask = valid_mask.to(device=target.device, dtype=torch.bool)
            if valid_mask.shape != target.shape:
                raise ValueError("valid_mask must have the same shape as target")
        if not valid_mask.any(dim=1).all():
            raise ValueError("every target row must contain at least one supervised byte/EOS position")
        r = torch.rand(target.shape[0], 1, device=target.device) * 0.95 + 0.05
        masked = (torch.rand(target.shape, device=target.device) < r) & valid_mask
        # Generation starts from a COMPLETELY hidden block. Training the random
        # ratio alone almost never produces that state (r >= 1 is required), so
        # the model learned to copy visible answer bytes instead of decoding the
        # answer from the latent context. Half of the rows are therefore trained
        # from a fully hidden block, the exact condition `generate` starts in.
        all_hidden = torch.rand(target.shape[0], 1, device=target.device) < 0.5
        masked = torch.where(all_hidden, valid_mask, masked)
        # Guarantee at least one visible-to-predict supervised position per row.
        missing = ~masked.any(dim=1)
        if missing.any():
            first_valid = valid_mask.to(torch.int64).argmax(dim=1)
            rows = torch.arange(target.shape[0], device=target.device)[missing]
            masked[rows, first_valid[missing]] = True
        # Padding is never visible context: otherwise its repeated EOS IDs
        # disclose the target length during training, unlike all-hidden generation.
        input_masked = masked | ~valid_mask
        lg = self.logits(target, input_masked, z)
        return F.cross_entropy(lg[masked], target[masked])

    @torch.no_grad()
    def generate(self, z, steps: int = 10, temperature: float = 0.0, confident: float = 0.0, refine: int = 2):
        """confident > 0 (inference speed option, off by default): after a pass, if every still-hidden position is predicted with probability >= `confident`,
        they are all written at once and the remaining passes are skipped. refine > 0 re-masks the least-confident committed bytes and re-predicts them from
        the now-visible neighbours, so the first pass (written from a fully hidden block, i.e. the position prior) is not final. `self.last_passes` = passes run."""
        B, N = z.shape[0], self.block
        tok = torch.zeros(B, N, dtype=torch.long, device=z.device)
        masked = torch.ones(B, N, dtype=torch.bool, device=z.device)
        hidden = N
        self.last_passes = 0
        conf = torch.zeros(B, N, device=z.device)
        for s in range(steps):
            self.last_passes = s + 1
            probs = F.softmax(self.logits(tok, masked, z).float() / (temperature or 1.0), -1)
            if temperature:
                pred = torch.multinomial(probs.reshape(-1, probs.shape[-1]), 1).reshape(probs.shape[:2])      # exploration: a different but plausible command each time
                conf = probs.gather(-1, pred[..., None])[..., 0]
            else:
                conf, pred = probs.max(-1)
            if confident and s + 1 < steps and bool(((conf >= confident) | ~masked).all()):
                return torch.where(masked, pred, tok)
            conf = torch.where(masked, conf, torch.full_like(conf, -1.0))
            keep = N - (N * (s + 1)) // steps                       # hidden positions that remain after this pass
            k = hidden - keep
            if k > 0:
                idx = conf.topk(k, dim=1).indices
                tok = tok.scatter(1, idx, pred.gather(1, idx))
                masked = masked.scatter(1, idx, False)
                hidden = keep
        # Confidence-guided refinement: the first passes are written from a fully
        # hidden block, where the byte is decided by the position prior alone.
        # Re-hide the least-confident committed positions and re-predict them with
        # the rest of the block visible; this lets the latent context correct an
        # early fixed point instead of freezing it for the whole block.
        for _ in range(max(0, int(refine))):
            scores = torch.where(masked, torch.full_like(conf, float("inf")), conf)
            k = max(1, N // 8)
            idx = scores.topk(k, dim=1, largest=False).indices
            masked = masked.scatter(1, idx, True)
            probs = F.softmax(self.logits(tok, masked, z).float() / (temperature or 1.0), -1)
            if temperature:
                pred = torch.multinomial(probs.reshape(-1, probs.shape[-1]), 1).reshape(probs.shape[:2])
                updated = probs.gather(-1, pred[..., None])[..., 0]
            else:
                updated, pred = probs.max(-1)
            tok = tok.scatter(1, idx, pred.gather(1, idx))
            conf = conf.scatter(1, idx, updated.gather(1, idx))
            masked = masked.scatter(1, idx, False)
            self.last_passes += 1
        return tok
