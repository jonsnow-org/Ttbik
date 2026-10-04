"""
Sham's mixed-precision switch ("الدقة المختلطة") — more learning per GPU hour, free.

Kaggle's T4 does 16-bit maths on its tensor cores several times faster than 32-bit; until
now every notebook trained in 32-bit. This module (installed from sham_inputs, no cell
change) turns on train.py's existing fp16 + GradScaler path for every GPU session and gives
sham_live the same autocast. A GPU whose hardware has no real bf16 (anything before Ampere,
which includes the T4: PyTorch still answers "supported" through slow emulation) uses fp16 with
loss scaling; CPU sessions are untouched. SHAM_FP32=1 switches it off.
"""

from __future__ import annotations

import os

import torch


def enabled(device) -> bool:
    return str(device).startswith("cuda") and torch.cuda.is_available() and not os.environ.get("SHAM_FP32")


def amp_dtype():
    """bf16 only where the hardware really has it (compute capability >= 8)."""
    if torch.cuda.is_available() and torch.cuda.get_device_capability()[0] >= 8:
        return torch.bfloat16
    return torch.float16


def install() -> None:
    import train as _train

    if getattr(_train.train, "_sham_amp", False):
        return
    original = _train.train

    def train_amp(model, batches, cfg, device="cpu", *args, **kwargs):
        if enabled(device) and not cfg.mixed_precision:
            cfg = _train.TrainConfig(**{**cfg.__dict__, "mixed_precision": True})
            print(f"⚡ دقة مختلطة ({'bf16' if amp_dtype() == torch.bfloat16 else 'fp16'}) مُفعَّلة لهذه الجلسة")
        return original(model, batches, cfg, device, *args, **kwargs)

    train_amp._sham_amp = True
    _train.train = train_amp


if __name__ == "__main__":
    import train as _train
    from model import ShamSmall, ShamSmallConfig

    cfg = ShamSmallConfig(vocab_size=42256, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=16)
    assert not enabled("cpu") and amp_dtype() in (torch.float16, torch.bfloat16)
    install(); install()
    seen = {}
    real = _train.train.__closure__[0].cell_contents  # the original
    m = ShamSmall(cfg)
    tc = _train.TrainConfig(total_steps=3, warmup_steps=1, grad_accum_steps=1)
    hist = _train.train(m, [torch.randint(0, 100, (2, 16)) for _ in range(3)], tc, "cpu")
    assert len(hist) == 3  # CPU: unchanged behaviour
    print("sham_amp self-test OK")
