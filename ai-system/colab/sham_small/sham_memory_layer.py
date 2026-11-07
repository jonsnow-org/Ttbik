"""
Sham — a sparse knowledge-memory layer ("طبقة الذاكرة"): more knowledge capacity for almost no extra compute.

A transformer stores facts in its feed-forward (MLP) weights, and every token pays for ALL of them (dense compute). A memory layer (Lample et al. 2019,
"Large Memory Layers with Product Keys"; scaled by Meta FAIR in "Memory Layers at Scale", 2024) is a big table of key -> value vectors where each token reads
only its top-k slots: the table can be 10-100x larger than an MLP while the compute per token stays about the same. Facts are exactly the kind of knowledge that
fits a lookup table. Product keys make the search cheap: a key is a PAIR of half-keys, so scoring n_keys + n_keys half-keys addresses n_keys**2 slots.

`ProductKeyMemory` has the same call signature as `SwiGLU` in model.py (x -> same shape), so it can replace the MLP of chosen blocks:

    from sham_memory_layer import replace_mlp_with_memory
    replace_mlp_with_memory(model, layers=[8, 16], n_keys=256)       # 65,536 slots in each of those blocks
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F


class ProductKeyMemory(nn.Module):
    def __init__(self, d_model: int, n_keys: int = 128, topk: int = 8, heads: int = 4, key_dim: int = 64):
        super().__init__()
        assert key_dim % 2 == 0
        self.d_model, self.n_keys, self.topk, self.heads, self.key_dim = d_model, n_keys, topk, heads, key_dim
        self.query = nn.Linear(d_model, heads * key_dim, bias=False)
        self.keys1 = nn.Parameter(torch.randn(heads, n_keys, key_dim // 2) * (key_dim // 2) ** -0.5)
        self.keys2 = nn.Parameter(torch.randn(heads, n_keys, key_dim // 2) * (key_dim // 2) ** -0.5)
        self.values = nn.EmbeddingBag(n_keys * n_keys, d_model, mode="sum")
        nn.init.normal_(self.values.weight, mean=0.0, std=d_model ** -0.5)
        self.norm = nn.LayerNorm(heads * key_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b, t, _ = x.shape
        n = b * t
        q = self.norm(self.query(x.reshape(n, -1))).view(n, self.heads, self.key_dim)
        q1, q2 = q[..., : self.key_dim // 2], q[..., self.key_dim // 2:]
        s1 = torch.einsum("nhd,hkd->nhk", q1, self.keys1)
        s2 = torch.einsum("nhd,hkd->nhk", q2, self.keys2)
        v1, i1 = s1.topk(self.topk, dim=-1)
        v2, i2 = s2.topk(self.topk, dim=-1)
        score = (v1.unsqueeze(-1) + v2.unsqueeze(-2)).reshape(n, self.heads, -1)
        index = (i1.unsqueeze(-1) * self.n_keys + i2.unsqueeze(-2)).reshape(n, self.heads, -1)
        top_s, pos = score.topk(self.topk, dim=-1)
        top_i = index.gather(-1, pos)
        w = F.softmax(top_s, dim=-1)
        out = self.values(top_i.reshape(n, -1), per_sample_weights=w.reshape(n, -1))
        return out.view(b, t, self.d_model)

    def slots(self) -> int:
        return self.n_keys * self.n_keys


def replace_mlp_with_memory(model, layers: list[int], n_keys: int = 128, topk: int = 8, heads: int = 4, key_dim: int = 64) -> int:
    """Swap the MLP of the chosen blocks of a ShamSmall for a memory layer. Returns the number of new parameters."""
    added = 0
    for i in layers:
        block = model.layers[i]
        removed = sum(p.numel() for p in block.mlp.parameters())
        block.mlp = ProductKeyMemory(model.cfg.d_model, n_keys, topk, heads, key_dim)
        added += sum(p.numel() for p in block.mlp.parameters()) - removed
    return added


def _selftest() -> None:
    torch.manual_seed(0)
    m = ProductKeyMemory(32, n_keys=16, topk=4, heads=2, key_dim=16)
    x = torch.randn(3, 5, 32, requires_grad=True)
    y = m(x)
    assert y.shape == x.shape and torch.isfinite(y).all()
    y.sum().backward()
    assert m.values.weight.grad is not None and m.keys1.grad is not None and x.grad is not None
    # a token reads at most heads*topk slots: the gradient touches few rows
    touched = int((m.values.weight.grad.abs().sum(-1) > 0).sum())
    assert touched <= 3 * 5 * 2 * 4 and touched < m.slots()
    print("sham_memory_layer self-test OK  (slots=%d, rows touched by 15 tokens=%d)" % (m.slots(), touched))


if __name__ == "__main__":
    _selftest()
