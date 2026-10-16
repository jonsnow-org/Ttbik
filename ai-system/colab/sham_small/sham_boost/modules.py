"""Zero-gated add-ons for Sham.

Every add-on is attached BESIDE the existing weights and is multiplied by
tanh(gate) with gate initialised to exactly 0.0, so a freshly built boost
gives logits that are bit-for-bit those of the plain model (checked by
verify_boost.py). The gate still receives a gradient at 0 (d tanh/dg = 1),
so training opens it only as far as the loss actually improves.

Contents
  GatedQKNorm          per-head RMS norm on q/k, blended in by a gate
  z_loss               small penalty on log-partition, keeps logits bounded at higher lr
  GatedEmbedAdapter    extra embedding rows for chosen (rare/weak) token ids
  GatedCrossAttn       shared core: residual-stream reads from external slots
  MemoryBank           retrieval memory built from Sham's own hidden states
  GatedCrossAttnMemory cross-attention into retrieved MemoryBank slots
  MediaEncoder         small own encoders for image patches, spectrograms, video frames
  GatedMediaBridge     encodes media into d_model prefix slots read through GatedCrossAttn
  ShortLongContext     sequence-length curriculum (mostly short, short long phases)
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F


def _gate(g: torch.Tensor) -> torch.Tensor:
    return torch.tanh(g)


class _HeadRMS(nn.Module):
    def __init__(self, dim: int, eps: float = 1e-6):
        super().__init__()
        self.eps = eps
        self.weight = nn.Parameter(torch.ones(dim))

    def forward(self, x):
        xf = x.float()
        return (xf * torch.rsqrt(xf.pow(2).mean(-1, keepdim=True) + self.eps)).to(x.dtype) * self.weight


class GatedQKNorm(nn.Module):
    """q' = q + tanh(g)·(norm(q)·w − q)  (same for k). Identity while g = 0."""

    def __init__(self, head_dim: int):
        super().__init__()
        self.qn, self.kn = _HeadRMS(head_dim), _HeadRMS(head_dim)
        self.gate = nn.Parameter(torch.zeros(()))

    def is_closed(self) -> bool:
        return bool(self.gate.detach() == 0)

    def forward(self, q, k):
        a = _gate(self.gate)
        return q + a * (self.qn(q) - q), k + a * (self.kn(k) - k)


def z_loss(logits: torch.Tensor, weight: float = 1e-4, mask: torch.Tensor | None = None) -> torch.Tensor:
    z = torch.logsumexp(logits.float(), dim=-1).pow(2)
    if mask is not None:
        return weight * (z * mask).sum() / mask.sum().clamp_min(1)
    return weight * z.mean()


class GatedEmbedAdapter(nn.Module):
    """Adds tanh(g)·up(extra[row(id)]) to the input embedding of the chosen ids.
    Ids not in the list map to row 0, which is pinned to zero."""

    def __init__(self, vocab_size: int, d_model: int, token_ids: list[int], rank: int = 128):
        super().__init__()
        remap = torch.zeros(vocab_size, dtype=torch.long)
        for i, t in enumerate(sorted(set(int(t) for t in token_ids))):
            remap[t] = i + 1
        self.register_buffer("remap", remap)
        self.extra = nn.Embedding(len(set(token_ids)) + 1, rank)
        nn.init.normal_(self.extra.weight, std=0.02)
        with torch.no_grad():
            self.extra.weight[0].zero_()
        self.up = nn.Linear(rank, d_model, bias=False)
        nn.init.normal_(self.up.weight, std=0.02)
        self.gate = nn.Parameter(torch.zeros(()))

    def forward(self, ids, x):
        rows = self.remap[ids]
        add = self.up(self.extra(rows)) * (rows > 0).unsqueeze(-1).to(x.dtype)
        return x + _gate(self.gate) * add

    @staticmethod
    def rare_ids_from_counts(counts: torch.Tensor, n: int, min_count: int = 1) -> list[int]:
        """Least-seen ids that appeared at least `min_count` times."""
        idx = torch.nonzero(counts >= min_count).flatten()
        order = torch.argsort(counts[idx])
        return idx[order[:n]].tolist()


class GatedCrossAttn(nn.Module):
    """x + tanh(g)·o(attn(norm(x) → slots)). Slots: (B, S, d_slot)."""

    def __init__(self, d_model: int, d_slot: int, n_heads: int = 4, eps: float = 1e-5):
        super().__init__()
        self.h, self.hd = n_heads, d_model // n_heads
        self.norm = _HeadRMS(d_model, eps)
        self.snorm = _HeadRMS(d_slot, eps)
        self.q = nn.Linear(d_model, d_model, bias=False)
        self.kv = nn.Linear(d_slot, 2 * d_model, bias=False)
        self.o = nn.Linear(d_model, d_model, bias=False)
        for m in (self.q, self.kv, self.o):
            nn.init.normal_(m.weight, std=0.02)
        self.gate = nn.Parameter(torch.zeros(()))

    def forward(self, x, slots, slot_mask=None, pos_mask=None):
        if slots is None:
            return x
        B, T, D = x.shape
        q = self.q(self.norm(x)).view(B, T, self.h, self.hd).transpose(1, 2)
        k, v = self.kv(self.snorm(slots)).chunk(2, dim=-1)
        k = k.view(B, -1, self.h, self.hd).transpose(1, 2)
        v = v.view(B, -1, self.h, self.hd).transpose(1, 2)
        am = None if slot_mask is None else slot_mask[:, None, None, :]
        y = F.scaled_dot_product_attention(q, k, v, attn_mask=am)
        y = self.o(y.transpose(1, 2).reshape(B, T, D))
        if pos_mask is not None:
            y = y * pos_mask[..., None].to(y.dtype)
        return x + _gate(self.gate) * y


class MemoryBank:
    """Keys/values built from Sham's OWN hidden states over a text corpus.
    keys:  (N, d) unit-norm mean of a chunk's hidden states (retrieval)
    slots: (N, m, d) the chunk summarised into m segment means (what is read)."""

    def __init__(self, keys: torch.Tensor, slots: torch.Tensor):
        self.keys, self.slots = F.normalize(keys.float(), dim=-1), slots.float()

    @classmethod
    @torch.no_grad()
    def build(cls, hidden_fn, chunks: list[torch.Tensor], segments: int = 8) -> "MemoryBank":
        """hidden_fn(ids (1,T)) -> (1,T,d) hidden at the read layer."""
        keys, slots = [], []
        for ids in chunks:
            h = hidden_fn(ids.view(1, -1))[0].float()
            keys.append(h.mean(0))
            segs = torch.tensor_split(h, segments, dim=0)
            slots.append(torch.stack([s.mean(0) if len(s) else torch.zeros(h.shape[-1]) for s in segs]))
        return cls(torch.stack(keys), torch.stack(slots))

    def retrieve(self, query: torch.Tensor, top_k: int = 4) -> torch.Tensor:
        """query (B, d) -> (B, top_k*m, d)."""
        sims = F.normalize(query.float(), dim=-1) @ self.keys.T
        idx = sims.topk(min(top_k, self.keys.shape[0]), dim=-1).indices
        return self.slots[idx].flatten(1, 2)

    def save(self, path):
        torch.save({"keys": self.keys, "slots": self.slots}, path)

    @classmethod
    def load(cls, path):
        d = torch.load(path, map_location="cpu")
        return cls(d["keys"], d["slots"])


class GatedCrossAttnMemory(nn.Module):
    """Retrieval read. The query is the mean hidden state of the first
    `probe` tokens; only positions >= probe read the memory, so no token
    ever sees a retrieval decided by its own future."""

    def __init__(self, d_model: int, n_heads: int = 4, top_k: int = 4, probe: int = 64):
        super().__init__()
        self.xattn = GatedCrossAttn(d_model, d_model, n_heads)
        self.top_k, self.probe = top_k, probe
        self.bank: MemoryBank | None = None

    def forward(self, x):
        if self.bank is None or x.shape[1] <= self.probe:
            return x
        p = min(self.probe, x.shape[1])
        slots = self.bank.retrieve(x[:, :p].detach().mean(1), self.top_k).to(x.dtype).to(x.device)
        pos = torch.arange(x.shape[1], device=x.device)[None].expand(x.shape[0], -1) >= p
        return self.xattn(x, slots, pos_mask=pos)


class _TinyEncoder(nn.Module):
    def __init__(self, d: int, layers: int = 2, heads: int = 4, max_len: int = 1024):
        super().__init__()
        self.pos = nn.Parameter(torch.zeros(1, max_len, d))
        layer = nn.TransformerEncoderLayer(d, heads, 4 * d, dropout=0.0, batch_first=True, norm_first=True)
        self.body = nn.TransformerEncoder(layer, layers, enable_nested_tensor=False)

    def forward(self, x):
        return self.body(x + self.pos[:, : x.shape[1]])


class MediaEncoder(nn.Module):
    """Trained from scratch. image (B,3,H,W) -> patches; audio (B,n_mels,T) ->
    strided conv frames; video (B,F,3,H,W) -> per-frame patches pooled to a
    few tokens per frame. Output (B, S, d_enc)."""

    def __init__(self, d_enc: int = 256, patch: int = 16, n_mels: int = 80, tokens_per_frame: int = 4):
        super().__init__()
        self.patch, self.tpf = patch, tokens_per_frame
        self.img = nn.Conv2d(3, d_enc, patch, stride=patch)
        self.aud = nn.Sequential(nn.Conv1d(n_mels, d_enc, 3, padding=1), nn.GELU(),
                                 nn.Conv1d(d_enc, d_enc, 3, stride=2, padding=1))
        self.kind = nn.Embedding(3, d_enc)
        self.enc = _TinyEncoder(d_enc)

    def image(self, px):
        t = self.img(px).flatten(2).transpose(1, 2)
        return self.enc(t + self.kind.weight[0])

    def audio(self, mel):
        t = self.aud(mel).transpose(1, 2)
        return self.enc(t + self.kind.weight[1])

    def video(self, frames):
        B, Fr = frames.shape[:2]
        t = self.img(frames.flatten(0, 1)).flatten(2).transpose(1, 2)        # (B*F, P, d)
        t = F.adaptive_avg_pool1d(t.transpose(1, 2), self.tpf).transpose(1, 2)
        t = t.reshape(B, Fr * self.tpf, -1)
        return self.enc(t + self.kind.weight[2])


class GatedMediaBridge(nn.Module):
    """Media -> d_model prefix slots -> read by gated cross-attention at the
    chosen layers. The prefix never enters the token sequence itself, so
    positions, cache and logits of the text are untouched at gate 0."""

    def __init__(self, d_model: int, d_enc: int = 256, n_heads: int = 4, n_reads: int = 2, **enc_kw):
        super().__init__()
        self.encoder = MediaEncoder(d_enc, **enc_kw)
        self.proj = nn.Sequential(nn.Linear(d_enc, d_model), nn.GELU(), nn.Linear(d_model, d_model))
        self.reads = nn.ModuleList(GatedCrossAttn(d_model, d_model, n_heads) for _ in range(n_reads))

    def encode(self, image=None, audio=None, video=None):
        parts = []
        if image is not None:
            parts.append(self.encoder.image(image))
        if audio is not None:
            parts.append(self.encoder.audio(audio))
        if video is not None:
            parts.append(self.encoder.video(video))
        if not parts:
            return None
        return self.proj(torch.cat(parts, dim=1))


@dataclass
class ShortLongContext:
    """Most steps at `short`; every `period` steps a `long_steps` phase at
    `long` (clipped to the model's max_seq_len). Tokens per step stay the
    same by shrinking the batch during long phases."""
    short: int = 512
    long: int = 2048
    period: int = 1000
    long_steps: int = 100

    def seq_len(self, global_step: int, max_seq_len: int) -> int:
        in_long = (global_step % self.period) >= (self.period - self.long_steps)
        return min(self.long if in_long else self.short, max_seq_len)

    def batch_size(self, global_step: int, base_batch: int, max_seq_len: int) -> int:
        return max(1, base_batch * self.short // self.seq_len(global_step, max_seq_len))
