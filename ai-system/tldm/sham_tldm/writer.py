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

    def logits(self, tokens, masked, z):
        x = self.embed(tokens)
        x = torch.where(masked[..., None], self.mask_emb.to(x.dtype).expand_as(x), x) + self.pos(torch.arange(self.block, device=x.device))
        for layer in self.layers:
            x = layer(x, z)
        return self.head(self.norm(x))

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
        # Guarantee at least one visible-to-predict supervised position per row.
        missing = ~masked.any(dim=1)
        if missing.any():
            first_valid = valid_mask.to(torch.int64).argmax(dim=1)
            rows = torch.arange(target.shape[0], device=target.device)[missing]
            masked[rows, first_valid[missing]] = True
        lg = self.logits(target, masked, z)
        return F.cross_entropy(lg[masked], target[masked])

    @torch.no_grad()
    def generate(self, z, steps: int = 10, temperature: float = 0.0, confident: float = 0.0):
        """confident > 0 (inference speed option, off by default): after a pass, if every still-hidden position is predicted with probability >= `confident`,
        they are all written at once and the remaining passes are skipped. `self.last_passes` = passes actually run."""
        B, N = z.shape[0], self.block
        tok = torch.zeros(B, N, dtype=torch.long, device=z.device)
        masked = torch.ones(B, N, dtype=torch.bool, device=z.device)
        hidden = N
        self.last_passes = 0
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
        return tok
