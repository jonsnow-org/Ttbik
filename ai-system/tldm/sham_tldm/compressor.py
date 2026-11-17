"""Compressor: any number of reader states -> a FIXED number of latent vectors (the report's 100k -> 1000). Learned queries cross-attend to the reader states, so a short input is
summarised (not expanded as a plain adaptive-average-pool would) and a very long one is first average-pooled to `pool_over` states (the report's AdaptiveAvgPool1d) and then attended."""
import torch
import torch.nn as nn
import torch.nn.functional as F


class Compressor(nn.Module):
    def __init__(self, d: int, n_latents: int, heads: int = 4, pool_over: int = 4096):
        super().__init__()
        self.q = nn.Parameter(torch.randn(n_latents, d) * 0.02)
        self.attn = nn.MultiheadAttention(d, heads, batch_first=True)
        self.norm = nn.LayerNorm(d)
        self.pool_over = pool_over

    def forward(self, h, pad_mask=None):          # h (B, T, d); pad_mask (B, T) True = ignore
        if h.shape[1] > self.pool_over:
            h = F.adaptive_avg_pool1d(h.transpose(1, 2), self.pool_over).transpose(1, 2)
            pad_mask = None
        q = self.q[None].expand(h.shape[0], -1, -1)
        z, _ = self.attn(q, h, h, key_padding_mask=pad_mask)
        return self.norm(z + q)
