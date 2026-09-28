"""
Per-session learning-rate schedule for resumed runs.

Real bug found in the owner's live chat-stage log (lr=5.05e-06 while the cell
asks for 5e-5): train.build_lr_scheduler counts warmup and cosine progress
from step 0 of the WHOLE lineage, while every notebook passes a per-session
warmup (e.g. 20) and total_steps = start_step + session_steps. Resuming at
step 41,094 therefore starts the cosine at ~98% done — the whole session
trains at the floor (min_lr_ratio × lr, i.e. one tenth of the intended rate).
The same happens in stage 1, Track A, stage 2 and the chat stage, every
session since they started resuming.

Fix without touching train.py (engineer-owned): when a run resumes
(last_epoch ≥ 0), warmup and cosine are counted from this session's first
step. Installed once by sham_inputs (which every training notebook imports
before training); fresh runs from step 0 behave exactly as before.
"""

from __future__ import annotations

import math

import torch


def session_lr_scheduler(optimizer, warmup_steps: int, total_steps: int, min_lr_ratio: float, last_epoch: int = -1):
    start = max(last_epoch + 1, 0)
    span = max(1, total_steps - start)
    warmup = min(warmup_steps, span)

    def lr_lambda(step: int) -> float:
        s = step - start
        if s < warmup:
            return (s + 1) / max(1, warmup)
        if step >= total_steps:
            return min_lr_ratio
        progress = (s - warmup) / max(1, span - warmup)
        return min_lr_ratio + (1.0 - min_lr_ratio) * 0.5 * (1.0 + math.cos(math.pi * progress))

    if last_epoch != -1:
        for group in optimizer.param_groups:
            group.setdefault("initial_lr", group["lr"])
    return torch.optim.lr_scheduler.LambdaLR(optimizer, lr_lambda, last_epoch=last_epoch)


def install() -> None:
    import train

    if getattr(train.build_lr_scheduler, "_sham_session", False):
        return
    session_lr_scheduler._sham_session = True
    train.build_lr_scheduler = session_lr_scheduler


if __name__ == "__main__":
    import train as _train

    p = torch.nn.Parameter(torch.zeros(1))
    old = _train.build_lr_scheduler(torch.optim.SGD([p], lr=5e-5), 17, 41094 + 879, 0.1, last_epoch=41093)
    print(f"before fix: first lr {old.get_last_lr()[0]:.2e}")  # the live log's 5.05e-06
    install()
    opt = torch.optim.SGD([p], lr=5e-5)
    sch = _train.build_lr_scheduler(opt, 17, 41094 + 879, 0.1, last_epoch=41093)
    lrs = []
    for _ in range(879):
        lrs.append(sch.get_last_lr()[0]); opt.step(); sch.step()
    print(f"after fix: first {lrs[0]:.2e}, peak {max(lrs):.2e}, last {lrs[-1]:.2e}")
    assert lrs[0] < lrs[16] and abs(max(lrs) - 5e-5) < 1e-9 and lrs[-1] < 1e-5
    fresh = session_lr_scheduler(torch.optim.SGD([p], lr=1.0), 10, 100, 0.1)
    assert abs(fresh.get_last_lr()[0] - 0.1) < 1e-9  # step 0 of a fresh run: unchanged behaviour
    print("sham_schedule self-test OK")
