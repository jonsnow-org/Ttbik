"""Inference-only speed-up of a trained T-LDM: pick the weight format this CPU is fastest at, without retraining.

Measured on the 0.3B writer (d=1280, 4 layers, block 128, 2 pinned cores, docs/experiments/TLDM_WRITER_SPEED_NOTES.md):
  CPU with AMX (amx_bf16 flag, Sapphire Rapids and newer): bf16 weights ~4x faster per writer pass than fp32.
  CPU without AMX: bf16 is SLOWER than fp32 (no native bf16 matmul); dynamic INT8 Linear (fbgemm, VNNI/AVX2) is faster than fp32 (docs/experiments/TLDM_WRITER_SPEED_NOTES.md).
So mode="auto" = bf16 on AMX, int8 elsewhere. Only our own head is converted (bf16 - Sham1_TLDM: the whole model; DonorTLDM / FeatureTLDM: proj + core; ShamBodyTLDM: core. int8 - the writer, proj and Sham1's reader).
A frozen donor / Sham body keeps its own format. Accuracy of both formats is checked on the held-out gate by eval/writer_speed_gate.py."""
from __future__ import annotations

import os
import warnings

import torch
import torch.nn as nn
import torch.nn.functional as F


def cpu_has_amx() -> bool:
    try:
        with open("/proc/cpuinfo") as f:
            for line in f:
                if line.startswith("flags"):
                    return "amx_bf16" in line.split()
    except OSError:
        pass
    return False


def pick_mode(mode: str = "auto") -> str:
    mode = os.environ.get("TLDM_FAST", mode)
    if mode == "auto":
        return "bf16" if cpu_has_amx() else "int8"
    return mode


def _int8(mod: nn.Module) -> nn.Module:
    """Dynamic INT8 for every nn.Linear inside `mod` (and `mod` itself: quantize_dynamic alone never swaps the root module)."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            if type(mod) is nn.Linear:
                return torch.ao.quantization.quantize_dynamic(nn.Sequential(mod), {nn.Linear}, dtype=torch.qint8)[0]
            return torch.ao.quantization.quantize_dynamic(mod, {nn.Linear}, dtype=torch.qint8)
        except Exception:                                            # a torch without eager dynamic quantization: stay fp32
            return mod


def _lin(w, b):
    lin = nn.Linear(w.shape[1], w.shape[0], bias=b is not None)
    with torch.no_grad():
        lin.weight.copy_(w)
        if b is not None:
            lin.bias.copy_(b)
    return _int8(lin)


class _Attn(nn.Module):
    """nn.MultiheadAttention (batch_first, no masks) with INT8 q/k/v/out projections: PyTorch keeps MHA's packed in_proj and out_proj in fp32 under quantize_dynamic,
    which left half of every writer layer unquantized. `cache_kv`: the cross-attention keys/values of the latents are computed once per generate and reused by every
    writer pass (the latents do not change between passes)."""

    def __init__(self, mha: nn.MultiheadAttention, cache_kv: bool = False):
        super().__init__()
        d, w, b = mha.embed_dim, mha.in_proj_weight, mha.in_proj_bias
        self.h = mha.num_heads
        self.q, self.k, self.v = (_lin(w[i * d:(i + 1) * d], None if b is None else b[i * d:(i + 1) * d]) for i in range(3))
        self.o = _lin(mha.out_proj.weight, mha.out_proj.bias)
        self.cache_kv, self._mem, self._kv = cache_kv, None, None

    def _split(self, x):
        B, T, D = x.shape
        return x.view(B, T, self.h, D // self.h).transpose(1, 2)

    def forward(self, x, mem):
        if self.cache_kv and mem is self._mem:
            k, v = self._kv
        else:
            k, v = self._split(self.k(mem)), self._split(self.v(mem))
            if self.cache_kv:
                self._mem, self._kv = mem, (k, v)
        y = F.scaled_dot_product_attention(self._split(self.q(x)), k, v)
        B, H, T, E = y.shape
        return self.o(y.transpose(1, 2).reshape(B, T, H * E))


class _FastLayer(nn.Module):
    """A pre-norm (norm_first) nn.TransformerEncoderLayer / DecoderLayer with no masks, every Linear in INT8. Same math, same weights."""

    def __init__(self, layer: nn.Module):
        super().__init__()
        assert layer.norm_first, "only the pre-norm layers T-LDM builds"
        self.dec = isinstance(layer, nn.TransformerDecoderLayer)
        self.sa = _Attn(layer.self_attn)
        self.norm1, self.norm2 = layer.norm1, layer.norm2
        self.ff1, self.ff2, self.act = _lin(layer.linear1.weight, layer.linear1.bias), _lin(layer.linear2.weight, layer.linear2.bias), layer.activation
        if self.dec:
            self.ca, self.norm3 = _Attn(layer.multihead_attn, cache_kv=True), layer.norm3

    def forward(self, x, mem=None, *args, **kwargs):
        h = self.norm1(x)
        x = x + self.sa(h, h)
        if self.dec:
            x = x + self.ca(self.norm2(x), mem)
            return x + self.ff2(self.act(self.ff1(self.norm3(x))))
        return x + self.ff2(self.act(self.ff1(self.norm2(x))))


def fast_inference(model: nn.Module, mode: str = "auto") -> nn.Module:
    """In place where possible; returns the model. mode: auto | bf16 | int8 | fp32 (env TLDM_FAST overrides). Call after load_state_dict, for inference only."""
    mode = pick_mode(mode)
    model.eval()
    model.fast_mode = mode
    if mode == "fp32":
        return model
    if mode == "bf16":
        parts = ["proj", "core"] if any(hasattr(model, n) for n in ("donor", "body", "proj")) else None
        if parts is None:                                            # Sham1_TLDM: everything is ours
            return model.to(torch.bfloat16)
        for name in parts:
            if getattr(model, name, None) is not None:
                setattr(model, name, getattr(model, name).to(torch.bfloat16))
        return model
    # int8: every Linear of our head, including the attention projections PyTorch's quantize_dynamic skips (sham_tldm/fast.py _FastLayer): the writer (where the
    # time goes, with its latent keys/values cached across passes), the thinker cell, the projection and Sham1's own reader. The compressor (one attention over
    # the reader states, 16 queries) stays fp32. A frozen donor / Sham body keeps its own format.
    if isinstance(getattr(model, "proj", None), nn.Linear):
        model.proj = _int8(model.proj)
    core = model.core
    w = core.writer
    w.layers = nn.ModuleList(_FastLayer(l) for l in w.layers)
    if isinstance(w.head, nn.Linear) and not (isinstance(w.embed, nn.Embedding) and w.head.weight is w.embed.weight):
        w.head = _int8(w.head)
    core.thinker.cell = _FastLayer(core.thinker.cell)
    if hasattr(model, "reader") and not hasattr(model, "body"):
        model.reader = _int8(model.reader)
    return model
