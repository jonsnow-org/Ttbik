"""Inference-only speed-up of a trained T-LDM: pick the weight format this CPU is fastest at, without retraining.

Measured on the 0.3B writer (d=1280, 4 layers, block 128, 2 pinned cores, docs/experiments/tldm_writer_speed_2026-11-18.json):
  CPU with AMX (amx_bf16 flag, Sapphire Rapids and newer): bf16 weights ~4x faster per writer pass than fp32.
  CPU without AMX: bf16 is SLOWER than fp32 (no native bf16 matmul); dynamic INT8 Linear (fbgemm, VNNI/AVX2) is ~1.5x faster than fp32.
So mode="auto" = bf16 on AMX, int8 elsewhere. Only our own head is converted (bf16 - Sham1_TLDM: the whole model; DonorTLDM / FeatureTLDM: proj + core; ShamBodyTLDM: core. int8 - the writer, proj and Sham1's reader).
A frozen donor / Sham body keeps its own format. Accuracy of both formats is checked on the held-out gate by eval/writer_speed_gate.py."""
from __future__ import annotations

import os
import warnings

import torch
import torch.nn as nn


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
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        try:
            return torch.ao.quantization.quantize_dynamic(mod, {nn.Linear}, dtype=torch.qint8)
        except Exception:                                            # a torch without eager dynamic quantization: stay fp32
            return mod


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
    # int8: the writer (where the time goes), the projection and Sham1's own reader. The thinker / compressor (16 latents, cheap) stay fp32: PyTorch's
    # TransformerEncoderLayer fast path cannot read a quantized Linear.
    if isinstance(getattr(model, "proj", None), nn.Linear):
        model.proj = _int8(model.proj)
    model.core.writer = _int8(model.core.writer)
    if hasattr(model, "reader") and not hasattr(model, "body"):
        model.reader = _int8(model.reader)
    return model
