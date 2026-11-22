"""BitNet 1.58-bit: every weight is -1, 0 or +1 times one scale (the report's BitLinear), trained with the straight-through estimator.
Storage: five ternary weights fit one byte (3^5 = 243 <= 256) = 1.6 bits per weight = 0.2 bytes: the report's number, measured by bitnet_size_bytes()."""
import torch
import torch.nn as nn
import torch.nn.functional as F


class BitLinear(nn.Module):
    def __init__(self, in_f: int, out_f: int, bias: bool = False):
        super().__init__()
        self.weight = nn.Parameter(torch.randn(out_f, in_f) * 0.02)
        self.bias = nn.Parameter(torch.zeros(out_f)) if bias else None

    def ternary(self):
        scale = self.weight.abs().mean() + 1e-6
        return torch.round(self.weight / scale).clamp(-1, 1), scale

    def forward(self, x):
        if not self.training and not torch.is_grad_enabled():
            # inference: the ternary weight is computed once and reused (it was re-quantized on every call: 2-3x slower reader with BitNet on).
            # The cache is dropped by train() and whenever the weight tensor changes (version counter), so training and loading stay correct.
            key = (self.weight.data_ptr(), self.weight._version)
            if getattr(self, "_cache_key", None) != key:
                q, scale = self.ternary()
                self._cache, self._cache_key = (q * scale).detach(), key
            return F.linear(x, self._cache.to(x.dtype), self.bias)
        q, scale = self.ternary()
        w_eff = self.weight + (q * scale - self.weight).detach()
        return F.linear(x, w_eff, self.bias)

    def train(self, mode: bool = True):
        self._cache_key = None
        return super().train(mode)


def make_linear(i: int, o: int, bitnet: bool):
    return BitLinear(i, o) if bitnet else nn.Linear(i, o, bias=False)


def pack_ternary(q: torch.Tensor) -> bytes:
    flat = (q.flatten().to(torch.int64) + 1)                       # 0,1,2
    pad = (-flat.numel()) % 5
    if pad:
        flat = torch.cat([flat, torch.ones(pad, dtype=torch.int64)])
    g = flat.view(-1, 5)
    code = g[:, 0] + 3 * g[:, 1] + 9 * g[:, 2] + 27 * g[:, 3] + 81 * g[:, 4]
    return bytes(code.to(torch.uint8).tolist())


def unpack_ternary(blob: bytes, numel: int, shape=None) -> torch.Tensor:
    code = torch.tensor(list(blob), dtype=torch.int64)
    digits = torch.stack([(code // (3 ** k)) % 3 for k in range(5)], 1).flatten()[:numel]
    out = (digits - 1).to(torch.int8)
    return out.reshape(shape) if shape is not None else out


def bitnet_size_bytes(model: nn.Module) -> dict:
    """Real size if every BitLinear is stored packed (+ its fp32 scale) and everything else stays fp16."""
    packed = other = n_bit = 0
    seen = set()
    for m in model.modules():
        if isinstance(m, BitLinear):
            q, _ = m.ternary()
            packed += len(pack_ternary(q)) + 4
            n_bit += q.numel()
            seen.add(id(m.weight))
    for p in model.parameters():
        if id(p) not in seen:
            other += p.numel() * 2
    return {"bitlinear_weights": n_bit, "packed_bytes": packed, "other_fp16_bytes": other, "total_bytes": packed + other}
