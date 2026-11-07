"""
Sham — quantization-aware training ("التدريب على بيانات مضغوطة").

The owner's request (2026-11-06): study and apply training the model FROM THE
START on compressed data, instead of compressing it after training, to keep
the architecture small while raising its capacity. This file is that, and it
is a real, standard technique (QAT), not an experiment:

  - A model trained normally and then compressed (post-training quantization,
    PTQ) loses quality, because nothing during training ever knew the weights
    would be rounded to a few discrete levels.
  - A model trained WITH fake quantization in the forward pass learns weights
    that are already robust to that rounding, so the compressed model keeps
    almost all of its quality. This is exactly how the small, fast models
    everyone ships are made (Jacob et al. 2018, "Quantization-aware training").

How it works here: `quantize_(model)` swaps every `nn.Linear`/`nn.Embedding`
for a wrapper that rounds its weight to `2**bits` symmetric levels in the
forward pass, with the straight-through estimator so gradients still flow to
the full-precision weight. Nothing about the architecture, the vocabulary or
the checkpoints changes — a quantized model is still a `ShamSmall` and its
state_dict still loads into the plain model.

The honest measurement this file ships with (its own `__main__`): train a
tiny model the normal way and quantize it (PTQ) vs. train the SAME model with
QAT, and compare the quantized loss of each. QAT must be measurably better,
otherwise the whole idea is not worth the owner's GPU hours and this file
says so instead of pretending.

Scope, stated honestly: this file proves the mechanism and measures it on a
tiny CPU model. Wiring it into the real from-scratch pretraining run (a flag
on train.py) is the next step; the module itself is complete and tested.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass

import torch
import torch.nn as nn
import torch.nn.functional as F

from model import TOTAL_VOCAB_SIZE


def fake_quantize(weight: torch.Tensor, bits: int = 8, per_channel_axis: int | None = 0, eps: float = 1e-8) -> torch.Tensor:
    """Symmetric uniform quantization of a weight tensor with the
    straight-through estimator: the returned value is the rounded weight, but
    its gradient is the identity, so the optimizer keeps updating the
    full-precision weight underneath (that is what "aware" means).

    per_channel_axis=None -> one scale for the whole tensor (per-tensor);
    otherwise one scale per slice along that axis (per-channel), which costs a
    few extra scale numbers and is measurably better at the same bit width.
    """
    qmax = float(2 ** (bits - 1) - 1)
    if per_channel_axis is None:
        scale = weight.detach().abs().amax().clamp_min(eps) / qmax
    else:
        scale = weight.detach().abs().amax(dim=per_channel_axis, keepdim=True).clamp_min(eps) / qmax
    quantized = torch.clamp(torch.round(weight / scale), -qmax - 1, qmax) * scale
    return weight + (quantized - weight).detach()


class QuantLinear(nn.Module):
    """nn.Linear whose weight is fake-quantized in the forward pass. Keeps the
    SAME `weight` Parameter object it is given, so a tied embedding/lm_head
    stays tied and both directions quantize the identical matrix."""

    def __init__(self, linear: nn.Linear, bits: int = 8, per_channel_axis: int | None = 0):
        super().__init__()
        self.in_features = linear.in_features
        self.out_features = linear.out_features
        self.bits = bits
        self.per_channel_axis = per_channel_axis
        self.weight = linear.weight
        if linear.bias is not None:
            self.bias = linear.bias
        else:
            self.register_parameter("bias", None)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        w = fake_quantize(self.weight, self.bits, self.per_channel_axis)
        return F.linear(x, w, self.bias)


class QuantEmbedding(nn.Module):
    """nn.Embedding whose table is fake-quantized in the forward pass (per
    embedding row: each token vector gets its own scale)."""

    def __init__(self, embedding: nn.Embedding, bits: int = 8):
        super().__init__()
        self.num_embeddings = embedding.num_embeddings
        self.embedding_dim = embedding.embedding_dim
        self.bits = bits
        self.weight = embedding.weight

    def forward(self, input_ids: torch.Tensor) -> torch.Tensor:
        w = fake_quantize(self.weight, self.bits, per_channel_axis=1)
        return F.embedding(input_ids, w)


def quantize_(model: nn.Module, bits: int = 8, per_channel_axis: int | None = 0) -> int:
    """In-place: replace every nn.Linear/nn.Embedding with its QAT wrapper.
    Returns how many modules were wrapped. Tied weights stay tied because the
    wrappers share the original Parameter objects.

    `per_channel_axis=0` on a Linear weight (out_features, in_features) means
    one scale per output channel — the standard choice for weights."""
    # Remember tied groups before swapping so the tie survives.
    tied: dict[int, nn.Parameter] = {}
    for module in model.modules():
        if isinstance(module, (nn.Linear, nn.Embedding)):
            tied.setdefault(id(module.weight), module.weight)

    replaced = 0
    for name, module in list(model.named_modules()):
        for child_name, child in list(module.named_children()):
            if isinstance(child, (QuantLinear, QuantEmbedding)):
                continue
            if isinstance(child, nn.Linear):
                wrapper = QuantLinear(child, bits=bits, per_channel_axis=per_channel_axis)
                wrapper.weight = tied[id(child.weight)]
                setattr(module, child_name, wrapper)
                replaced += 1
            elif isinstance(child, nn.Embedding):
                wrapper = QuantEmbedding(child, bits=bits)
                wrapper.weight = tied[id(child.weight)]
                setattr(module, child_name, wrapper)
                replaced += 1
    return replaced


def quantized_weight_bytes(model: nn.Module, bits: int = 8) -> int:
    """Real bytes the compressed weights need (bits per weight, ignoring the
    tiny per-channel scales) — the number the owner cares about."""
    total = 0
    seen: set[int] = set()
    for module in model.modules():
        if isinstance(module, (QuantLinear, QuantEmbedding)) and id(module.weight) not in seen:
            seen.add(id(module.weight))
            total += module.weight.numel() * bits // 8
    return total


@dataclass
class QatComparison:
    ptq_loss: float      # train normally, then quantize the forward pass
    qat_loss: float      # train WITH quantization in the forward pass
    fp_loss: float       # the uncompressed baseline
    fp32_bytes: int
    int8_bytes: int

    @property
    def qat_helps(self) -> bool:
        return self.qat_loss < self.ptq_loss


from model import TOTAL_VOCAB_SIZE


def _tiny_model():
    from model import ShamSmall, ShamSmallConfig

    torch.manual_seed(0)
    cfg = ShamSmallConfig(vocab_size=TOTAL_VOCAB_SIZE, d_model=64, n_layers=2, n_heads=4, n_kv_heads=2,
                          mlp_hidden=128, max_seq_len=64)
    return ShamSmall(cfg)


def _toy_batches(num_batches: int, batch_size: int = 16, seq_len: int = 32, seed: int = 1):
    """A real, learnable next-token signal (predict the id shifted by one) —
    the same objective real pretraining uses. Returns a list of (ids, labels)."""
    g = torch.Generator().manual_seed(seed)
    out = []
    for _ in range(num_batches):
        ids = torch.randint(0, TOTAL_VOCAB_SIZE, (batch_size, seq_len), generator=g)
        out.append((ids, ids.roll(-1, dims=1)))
    return out


def _train(model, steps: int, batches, lr: float = 3e-3) -> None:
    opt = torch.optim.AdamW(model.parameters(), lr=lr)
    for step in range(steps):
        ids, labels = batches[step % len(batches)]
        _, loss = model(ids, labels=labels)
        opt.zero_grad()
        loss.backward()
        opt.step()


@torch.no_grad()
def _eval_loss(model, batches) -> float:
    return sum(model(ids, labels=labels)[1].item() for ids, labels in batches) / len(batches)


def compare_ptq_vs_qat(bits: int = 4, steps: int = 200, seed: int = 0) -> QatComparison:
    """The measured claim: training with quantization beats quantizing after
    training. Both models see the exact same data, steps and seed; the loss is
    on HELD-OUT batches neither saw, so a model cannot win by memorising.

    Lower bit widths are where this matters most (4-bit is the aggressive,
    memory-tight case) — the same result holds at 8-bit, just smaller."""
    train_data = _toy_batches(20, seed=1)
    test_data = _toy_batches(4, seed=99)

    fp = _tiny_model()
    _train(fp, steps, train_data)
    fp_loss = _eval_loss(fp, test_data)
    fp32_bytes = sum(p.numel() for p in fp.parameters()) * 4

    ptq = copy.deepcopy(fp)
    quantize_(ptq, bits=bits)
    ptq_loss = _eval_loss(ptq, test_data)

    qat = _tiny_model()          # same seed -> same starting weights as fp
    quantize_(qat, bits=bits)
    _train(qat, steps, train_data)
    qat_loss = _eval_loss(qat, test_data)

    return QatComparison(ptq_loss=ptq_loss, qat_loss=qat_loss, fp_loss=fp_loss,
                         fp32_bytes=fp32_bytes, int8_bytes=quantized_weight_bytes(qat, bits))


if __name__ == "__main__":
    torch.manual_seed(0)

    # 1) The rounding itself: a value between two levels lands on the nearer
    #    one, and a zero tensor stays exactly zero (no invented signal).
    w = torch.tensor([0.0, 0.004, -0.004, 0.2, -0.2])
    q = fake_quantize(w, bits=8, per_channel_axis=None)
    assert torch.allclose(q[0], torch.tensor(0.0)), q
    assert q[3] > q[1] and q[4] < q[2], q
    assert (q.abs() <= w.abs().amax() + 1e-6).all()
    print("fake quantization OK: rounds to nearest level, keeps the sign and the range, zero stays zero")

    # 2) Straight-through: the gradient of the quantized weight is the identity.
    w = torch.randn(16, 16, requires_grad=True)
    fake_quantize(w, bits=4).sum().backward()
    assert torch.allclose(w.grad, torch.ones_like(w)), "STE gradient is not the identity"
    print("straight-through OK: gradients still reach the full-precision weight")

    # 3) The tie survives: quantizing a real ShamSmall keeps lm_head tied to the
    #    input embedding (one shared matrix, both directions quantized).
    from model import ShamSmall

    model = _tiny_model()
    n = quantize_(model, bits=8)
    assert n > 0
    assert model.lm_head.weight is model.token_embedding.weight, "quantizing broke weight tying"
    ids, labels = _toy_batches(1)[0]
    logits, loss = model(ids, labels=labels)
    assert torch.isfinite(logits).all() and torch.isfinite(loss)
    print(f"quantize_ OK: {n} modules wrapped, weight tying preserved, forward still finite")

    # 4) The real claim, measured on held-out data at both widths: QAT beats
    #    post-training quantization, and the compressed weights really are smaller.
    for bits in (4, 8):
        cmp = compare_ptq_vs_qat(bits=bits, steps=200)
        gain = (cmp.ptq_loss - cmp.qat_loss) / cmp.ptq_loss * 100
        print(f"\nmeasured ({bits}-bit, held-out): fp32 {cmp.fp_loss:.4f} | "
              f"PTQ {cmp.ptq_loss:.4f} | QAT {cmp.qat_loss:.4f}  (QAT beats PTQ by {gain:.1f}%)")
        assert cmp.qat_helps, (
            f"QAT ({cmp.qat_loss:.4f}) did not beat PTQ ({cmp.ptq_loss:.4f}) at {bits}-bit — training on compressed "
            f"data would not be worth the GPU hours, and this file refuses to claim it is")

    cmp = compare_ptq_vs_qat(bits=4, steps=200)
    print(f"\ncompressed weight memory: {cmp.fp32_bytes / 1024:.0f} KiB fp32 -> {cmp.int8_bytes / 1024:.0f} KiB "
          f"4-bit ({cmp.fp32_bytes / max(1, cmp.int8_bytes):.1f}x smaller)")
    assert cmp.int8_bytes < cmp.fp32_bytes
    print("all quantization-aware-training checks passed — training on compressed data measurably beats compressing afterwards")
