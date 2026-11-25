"""guided_span with per-step scales: a scalar scale is unchanged; once only scale-1.0 steps remain the unconditional pass stops (video motion)."""
import os
import sys

import torch

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from model import ShamSmall, ShamSmallConfig  # noqa: E402
from sham_decoding import guided_span  # noqa: E402


class Counting(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m, self.calls = m, []

    def forward(self, ids, **kw):
        self.calls.append(int(ids.shape[1]))
        return self.m(ids, **kw)


def test_scalar_unchanged_and_uncond_stops():
    torch.manual_seed(0)
    m = ShamSmall(ShamSmallConfig(vocab_size=300, d_model=32, n_layers=2, n_heads=4, n_kv_heads=2, mlp_hidden=64, max_seq_len=256)).eval()
    cond, uncond = torch.tensor([[1, 5, 6, 7]]), torch.tensor([[1, 5]])
    forced = [None] * 12
    allowed = [(10, 200)] * 12
    torch.manual_seed(3)
    a = guided_span(m, cond, uncond, forced, allowed, scale=3.0)
    torch.manual_seed(3)
    b = guided_span(m, cond, uncond, forced, allowed, scale=[3.0] * 12)
    assert torch.equal(a, b)
    c = Counting(m)
    torch.manual_seed(3)
    out = guided_span(c, cond, uncond, forced, allowed, scale=[3.0] * 4 + [1.0] * 8)
    assert len(c.calls) == 12 + 4, c.calls                       # 12 conditional forwards + uncond only for the 4 guided steps
    assert out.shape == (1, 12) and all(10 <= t < 200 for t in out[0].tolist())
    c2 = Counting(m)
    guided_span(c2, cond, uncond, forced, allowed, scale=1.0)
    assert len(c2.calls) == 12                                   # scale 1.0 everywhere: no unconditional pass at all


if __name__ == "__main__":
    test_scalar_unchanged_and_uncond_stops()
    print("test_guided_span_scales OK")
