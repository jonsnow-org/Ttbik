"""Mamba-style reader block: a gated linear recurrence (state-space model) with a CHUNKED parallel scan. Cost is linear in the length and the decoding state is one vector per layer.
h_t = a_t * h_{t-1} + (1 - a_t) * v_t ;  y = h * silu(g)   (a_t in (0.6, 0.999): keeps exp(-cumsum(log a)) finite inside a chunk)."""
import torch
import torch.nn as nn
import torch.nn.functional as F

from .bitlinear import make_linear


class MambaBlock(nn.Module):
    def __init__(self, d: int, bitnet: bool = False, chunk: int = 32):
        super().__init__()
        self.chunk = chunk
        self.n1, self.n2 = nn.LayerNorm(d), nn.LayerNorm(d)
        self.p = make_linear(d, 3 * d, bitnet)
        self.o = make_linear(d, d, bitnet)
        self.mlp = nn.Sequential(make_linear(d, 4 * d, bitnet), nn.GELU(), make_linear(4 * d, d, bitnet))

    def _scan(self, u, la):
        b, t, d = u.shape
        pad = (-t) % self.chunk
        if pad:
            u, la = F.pad(u, (0, 0, 0, pad)), F.pad(la, (0, 0, 0, pad))
        n = u.shape[1] // self.chunk
        u, la = u.view(b, n, self.chunk, d), la.view(b, n, self.chunk, d)
        c = torch.cumsum(la, 2)
        intra = torch.exp(c) * torch.cumsum(u * torch.exp(-c), 2)
        carry, outs = torch.zeros(b, d, device=u.device, dtype=u.dtype), []
        for i in range(n):
            h = intra[:, i] + torch.exp(c[:, i]) * carry[:, None, :]
            outs.append(h)
            carry = h[:, -1]
        return torch.cat(outs, 1)[:, :t]

    def forward(self, x):
        v, g, a = self.p(self.n1(x)).chunk(3, -1)
        a = 0.6 + 0.399 * torch.sigmoid(a)
        h = self._scan((1 - a) * v, torch.log(a))
        x = x + self.o(h * F.silu(g))
        return x + self.mlp(self.n2(x))

    def step(self, x, h):                       # one token, O(1): x (B, d), h (B, d)
        v, g, a = self.p(self.n1(x)).chunk(3, -1)
        a = 0.6 + 0.399 * torch.sigmoid(a)
        h = a * h + (1 - a) * v
        x = x + self.o(h * F.silu(g))
        return x + self.mlp(self.n2(x)), h
