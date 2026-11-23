"""RMSNorm, RoPE, grouped-query attention with a K/V cache, SwiGLU and a sparse mixture-of-experts feed-forward."""
from __future__ import annotations

import torch
import torch.nn.functional as F
from torch import nn

from .config import ModelConfig

KV = tuple[torch.Tensor, torch.Tensor]


class RMSNorm(nn.Module):
    def __init__(self, width: int, eps: float = 1e-6) -> None:
        super().__init__()
        self.weight = nn.Parameter(torch.ones(width))
        self.eps = eps

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x * torch.rsqrt(x.pow(2).mean(-1, keepdim=True) + self.eps) * self.weight


def rope_tables(length: int, pairs: int, theta: float) -> tuple[torch.Tensor, torch.Tensor]:
    """cos/sin [length, pairs] for positions 0..length-1 on ONE axis, computed once in float64 (the model keeps them as buffers)."""
    inv = 1.0 / (theta ** (torch.arange(pairs, dtype=torch.float64) / pairs))
    ang = torch.arange(length, dtype=torch.float64)[:, None] * inv[None, :]
    return ang.cos(), ang.sin()


def apply_rope(x: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
    a, b = x[..., 0::2], x[..., 1::2]
    out = torch.stack((a * cos - b * sin, a * sin + b * cos), dim=-1)
    return out.flatten(-2)


class Attention(nn.Module):
    """Grouped-query attention. `prefix_kv` is the cached keys/values of earlier positions (causal decoding, or the T-LDM writer reading its prefix)."""

    def __init__(self, cfg: ModelConfig) -> None:
        super().__init__()
        self.h, self.kv = cfg.heads, cfg.kv_heads
        self.hd = cfg.width // cfg.heads
        self.theta = cfg.rope_theta
        self.q = nn.Linear(cfg.width, self.h * self.hd, bias=False)
        self.k = nn.Linear(cfg.width, self.kv * self.hd, bias=False)
        self.v = nn.Linear(cfg.width, self.kv * self.hd, bias=False)
        self.o = nn.Linear(self.h * self.hd, cfg.width, bias=False)

    def forward(self, x: torch.Tensor, rope: tuple[torch.Tensor, torch.Tensor], causal: bool, prefix_kv: KV | None = None) -> tuple[torch.Tensor, KV]:
        b, t, _ = x.shape
        q = self.q(x).view(b, t, self.h, self.hd).transpose(1, 2)
        k = self.k(x).view(b, t, self.kv, self.hd).transpose(1, 2)
        v = self.v(x).view(b, t, self.kv, self.hd).transpose(1, 2)
        cos, sin = rope                                   # already sliced to this call's positions
        q, k = apply_rope(q, cos, sin), apply_rope(k, cos, sin)
        if prefix_kv is not None:
            k_all, v_all = torch.cat([prefix_kv[0], k], dim=2), torch.cat([prefix_kv[1], v], dim=2)
        else:
            k_all, v_all = k, v
        mask, is_causal = None, False
        if causal:
            if prefix_kv is None:
                is_causal = True
            elif t > 1:                                   # a chunk after a cache: sees every cached position, and causally the chunk itself
                p = prefix_kv[0].shape[2]
                mask = torch.ones(t, p + t, dtype=torch.bool, device=x.device)
                mask[:, p:] = torch.tril(torch.ones(t, t, dtype=torch.bool, device=x.device))
        y = F.scaled_dot_product_attention(q, k_all, v_all, attn_mask=mask, is_causal=is_causal, enable_gqa=self.h != self.kv)
        return self.o(y.transpose(1, 2).reshape(b, t, self.h * self.hd)), (k_all, v_all)


class SwiGLU(nn.Module):
    def __init__(self, width: int, hidden: int) -> None:
        super().__init__()
        self.gate = nn.Linear(width, hidden, bias=False)
        self.up = nn.Linear(width, hidden, bias=False)
        self.down = nn.Linear(hidden, width, bias=False)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.down(F.silu(self.gate(x)) * self.up(x))


class MoE(nn.Module):
    """Sparse feed-forward: each token goes to its top-k experts, weighted by the renormalised router probabilities.
    `aux` is the load-balancing loss of the last call (1.0 when every expert gets an equal share)."""

    def __init__(self, cfg: ModelConfig) -> None:
        super().__init__()
        self.e, self.k = cfg.experts, cfg.top_k
        self.router = nn.Linear(cfg.width, cfg.experts, bias=False)
        self.experts = nn.ModuleList(SwiGLU(cfg.width, cfg.expert_hidden) for _ in range(cfg.experts))
        self.aux: torch.Tensor = torch.zeros(())

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, t, d = x.shape
        flat = x.reshape(-1, d)
        probs = torch.softmax(self.router(flat), dim=-1)
        top_p, top_i = probs.topk(self.k, dim=-1)
        top_p = top_p / top_p.sum(dim=-1, keepdim=True)
        out = torch.zeros_like(flat)
        if flat.shape[0] == 1:                                    # decode: run exactly the chosen experts, no scan over all of them
            for n in range(flat.shape[0]):
                for j in range(self.k):
                    out[n] += top_p[n, j] * self.experts[int(top_i[n, j])](flat[n:n + 1])[0]
            load = F.one_hot(top_i, self.e).sum(dim=1).to(probs.dtype).mean(dim=0) / self.k
            self.aux = self.e * (load * probs.mean(dim=0)).sum()
            return out.view(b, t, d)
        for e, expert in enumerate(self.experts):
            rows, slot = (top_i == e).nonzero(as_tuple=True)
            if rows.numel():
                out.index_add_(0, rows, expert(flat[rows]) * top_p[rows, slot].unsqueeze(-1))
        load = F.one_hot(top_i, self.e).sum(dim=1).to(probs.dtype).mean(dim=0) / self.k      # share of assignments per expert (sums to 1)
        self.aux = self.e * (load * probs.mean(dim=0)).sum()
        return out.view(b, t, d)


class Block(nn.Module):
    """One recurrent block: its weights are reused in every cycle."""

    def __init__(self, cfg: ModelConfig) -> None:
        super().__init__()
        self.norm1, self.attn = RMSNorm(cfg.width), Attention(cfg)
        self.norm2, self.moe = RMSNorm(cfg.width), MoE(cfg)

    def forward(self, x: torch.Tensor, rope: tuple[torch.Tensor, torch.Tensor], causal: bool, prefix_kv: KV | None = None) -> tuple[torch.Tensor, KV]:
        y, kv = self.attn(self.norm1(x), rope, causal, prefix_kv)
        x = x + y
        return x + self.moe(self.norm2(x)), kv


class CrossAttention(nn.Module):
    """Queries attend to a (short) memory: the learned latent compressor, and the writer's reader of the latents."""

    def __init__(self, width: int, heads: int) -> None:
        super().__init__()
        self.h, self.hd = heads, width // heads
        self.q, self.k, self.v, self.o = (nn.Linear(width, width, bias=False) for _ in range(4))
        self.norm_q, self.norm_m = RMSNorm(width), RMSNorm(width)

    def forward(self, queries: torch.Tensor, memory: torch.Tensor) -> torch.Tensor:
        b, tq, w = queries.shape
        tm = memory.shape[1]
        q = self.q(self.norm_q(queries)).view(b, tq, self.h, self.hd).transpose(1, 2)
        m = self.norm_m(memory)
        k = self.k(m).view(b, tm, self.h, self.hd).transpose(1, 2)
        v = self.v(m).view(b, tm, self.h, self.hd).transpose(1, 2)
        y = F.scaled_dot_product_attention(q, k, v)
        return self.o(y.transpose(1, 2).reshape(b, tq, w))
