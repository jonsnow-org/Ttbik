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

    def loss(self, z, target):                   # target (B, block)
        r = torch.rand(target.shape[0], 1, device=target.device) * 0.95 + 0.05
        masked = torch.rand(target.shape, device=target.device) < r
        masked[:, 0] |= ~masked.any(1)
        lg = self.logits(target, masked, z)
        return F.cross_entropy(lg[masked], target[masked])

    @torch.no_grad()
    def generate(self, z, steps: int = 10, temperature: float = 0.0, confident: float = 0.0, end_exit: bool = True, parallel: float = 0.0):
        """Inference speed options:
        confident > 0 (off by default): after a pass, if every still-hidden position is predicted with probability >= `confident`, they are all written at once and the
            remaining passes are skipped.
        end_exit (on by default, LOSSLESS for the decoded text): every tokenizer's decode() stops at the first PAD (0). Once a row has a written PAD and every position
            before it is written, nothing a later pass writes can change what that row decodes to (written positions are never rewritten), so when every row of the
            batch is in that state the remaining passes are skipped and the still-hidden tail is set to PAD. Raw tokens after the first PAD may differ; text never does.
        parallel > 0 (off by default, Fast-dLLM-style threshold decoding): each pass also writes every hidden position whose probability is >= `parallel`, on top of the
            schedule's quota, so confident blocks finish in fewer passes. Lossy in principle: check it on the held-out gate (eval/speed_accuracy.py) before using it.
        `self.last_passes` = passes actually run."""
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
            if parallel:
                left = masked.sum(1, keepdim=True)                                  # per row: rows may differ once the threshold writes extra positions
                rank = conf.argsort(1, descending=True).argsort(1)
                write = masked & ((rank < (left - keep).clamp(min=0)) | (conf >= parallel))
                tok = torch.where(write, pred, tok)
                masked = masked & ~write
            else:
                k = hidden - keep
                if k > 0:
                    idx = conf.topk(k, dim=1).indices
                    tok = tok.scatter(1, idx, pred.gather(1, idx))
                    masked = masked.scatter(1, idx, False)
                    hidden = keep
            if s + 1 < steps and not bool(masked.any()):                   # the threshold wrote everything: no pass left to run
                return tok
            if end_exit and s + 1 < steps and _ended(tok, masked):
                return tok.masked_fill(masked, 0)
        return tok


def _ended(tok, masked) -> bool:
    """True when every row has a written PAD whose whole prefix is written (the decoded text of the row can no longer change)."""
    written_prefix = torch.cumprod((~masked).to(torch.int8), 1).bool()
    return bool((written_prefix & (tok == 0)).any(1).all())
