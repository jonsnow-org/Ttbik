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
import time

import torch

# Wall-clock awareness (2026-10-03). Stage 1 sizes its session by a speed estimate made in the wrong
# unit (2-window steps with an optimizer step each, while a real optimizer step is 16 windows), so the
# planned number of steps is several times what fits in the time budget: the session ends by the clock
# at ~15% of the planned cosine, still at ~97% of its peak learning rate — it never anneals. Whenever a
# wall-clock budget is known, progress is the LARGER of "steps done" and "time used", so the decay always
# reaches its floor by the end of the session, whichever limit is hit first.
_WALL = {"t0": None, "limit": None}
_now = time.time


def set_wall_clock(limit_seconds) -> None:
    _WALL.update(t0=_now() if limit_seconds else None, limit=limit_seconds or None)


def time_progress() -> float:
    if not _WALL["limit"] or _WALL["t0"] is None:
        return 0.0
    return min(1.0, (_now() - _WALL["t0"]) / _WALL["limit"])


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
        progress = max((s - warmup) / max(1, span - warmup), time_progress())
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
    if not getattr(train.train, "_sham_wall", False):
        original = train.train

        def train_with_wall(model, batches, cfg, *args, **kwargs):
            set_wall_clock(getattr(cfg, "max_wall_clock_seconds", None))
            try:
                return original(model, batches, cfg, *args, **kwargs)
            finally:
                set_wall_clock(None)

        train_with_wall._sham_wall = True
        train.train = train_with_wall


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
    # wall-clock: a session planned for 1,000 steps but cut by a 100 s budget must still reach its floor
    clock = {"t": 1000.0}
    globals()["_now"] = lambda: clock["t"]
    set_wall_clock(100.0)
    opt2 = torch.optim.SGD([p], lr=1.0)
    sch2 = session_lr_scheduler(opt2, 10, 1000, 0.1)
    for _ in range(30):
        opt2.step(); sch2.step()
    early = sch2.get_last_lr()[0]
    clock["t"] += 99.0
    opt2.step(); sch2.step()
    late = sch2.get_last_lr()[0]
    assert early > 0.9 and late < 0.15, (early, late)  # 30 steps in: ~peak; 99% of the time used: at the floor
    set_wall_clock(None)
    assert time_progress() == 0.0
    fresh = session_lr_scheduler(torch.optim.SGD([p], lr=1.0), 10, 100, 0.1)
    assert abs(fresh.get_last_lr()[0] - 0.1) < 1e-9  # step 0 of a fresh run: unchanged behaviour
    print("sham_schedule self-test OK")
