"""Resumable warmup-stable-decay learning-rate schedule for Sham.

Why: train.build_lr_scheduler runs one cosine over cfg.total_steps and every
session resumes it at the global step, so a run that resumes at ~61k of ~62k
steps spends the whole session near the floor (lr * min_lr_ratio). This
schedule splits the curve into three parts keyed on the GLOBAL step:

  warmup  : first `warmup` steps after `start_global` (short, protects Adam
            moments after a resume)
  stable  : constant peak lr for as long as the session lasts
  decay   : a per-session tail — the last `decay_frac` of THIS session's
            steps goes down to `floor_ratio * peak` (1 - sqrt shape)

Because the tail belongs to each session, every saved checkpoint is a
"finished" one (good for the merge gate), and the next session simply
re-warms from the stable level instead of restarting a cosine.
CPU only, no dependencies beyond torch.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, asdict

import torch


@dataclass
class WSDConfig:
    peak_lr: float = 3e-4
    warmup: int = 200
    floor_ratio: float = 0.1
    decay_frac: float = 0.2      # last 20% of each session's steps
    decay_shape: str = "sqrt"    # "sqrt" | "linear" | "cos"

    def to_dict(self) -> dict:
        return asdict(self)


def wsd_factor(global_step: int, start_global: int, session_steps: int, c: WSDConfig) -> float:
    """Multiplier on peak_lr for `global_step` inside a session that began at
    `start_global` and lasts `session_steps` optimizer steps."""
    k = max(0, global_step - start_global)
    if c.warmup > 0 and k < c.warmup:
        return (k + 1) / c.warmup
    tail = max(1, int(round(session_steps * c.decay_frac)))
    decay_start = max(c.warmup, session_steps - tail)
    if k < decay_start:
        return 1.0
    p = min(1.0, (k - decay_start) / max(1, session_steps - decay_start))
    if c.decay_shape == "linear":
        s = 1.0 - p
    elif c.decay_shape == "cos":
        s = 0.5 * (1.0 + math.cos(math.pi * p))
    else:
        s = 1.0 - math.sqrt(p)
    return c.floor_ratio + (1.0 - c.floor_ratio) * s


def in_decay_tail(global_step: int, start_global: int, session_steps: int, c: WSDConfig) -> bool:
    k = global_step - start_global
    tail = max(1, int(round(session_steps * c.decay_frac)))
    return k >= max(c.warmup, session_steps - tail)


class WSDSchedule:
    """Drop-in stepper: call .step() after optimizer.step(). state_dict()
    stores the global step + session bounds so a crash mid-session resumes
    exactly where it was (same lr), not from the start of warmup."""

    def __init__(self, optimizer: torch.optim.Optimizer, c: WSDConfig, start_global: int, session_steps: int,
                 global_step: int | None = None):
        self.opt, self.c = optimizer, c
        self.start_global, self.session_steps = int(start_global), int(session_steps)
        self.global_step = int(start_global if global_step is None else global_step)
        self._apply()

    def lr(self) -> float:
        return self.c.peak_lr * wsd_factor(self.global_step, self.start_global, self.session_steps, self.c)

    def _apply(self) -> None:
        for g in self.opt.param_groups:
            g["lr"] = self.lr() * g.get("lr_scale", 1.0)

    def step(self) -> None:
        self.global_step += 1
        self._apply()

    def in_tail(self) -> bool:
        return in_decay_tail(self.global_step, self.start_global, self.session_steps, self.c)

    def state_dict(self) -> dict:
        return {"cfg": self.c.to_dict(), "start_global": self.start_global,
                "session_steps": self.session_steps, "global_step": self.global_step}

    @classmethod
    def from_state(cls, optimizer, state: dict) -> "WSDSchedule":
        return cls(optimizer, WSDConfig(**state["cfg"]), state["start_global"], state["session_steps"],
                   global_step=state["global_step"])


def cosine_resume_lr(global_step: int, total_steps: int, warmup: int, peak: float, min_ratio: float) -> float:
    """What train.build_lr_scheduler gives at `global_step` (for the report only)."""
    if global_step < warmup:
        return peak * (global_step + 1) / max(1, warmup)
    p = min(1.0, (global_step - warmup) / max(1, total_steps - warmup))
    return peak * (min_ratio + (1 - min_ratio) * 0.5 * (1 + math.cos(math.pi * p)))
