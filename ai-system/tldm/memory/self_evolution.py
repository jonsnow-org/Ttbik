"""Self-evolution (section 7 of the book): the terminal's verdict is the reward.
  * the FILE SYSTEM is the long-term memory: every finished episode is written as one JSON file, successes to memory_lora/, failures to memory_errors/ (the lessons);
  * RECALL: before acting, the agent looks up an earlier success for the same task (non-parametric learning: no training, immediate);
  * LoRA: successes are also what a small low-rank delta is trained on (theta_new = theta_old + Delta_LoRA); the delta is a separate file that can be loaded, swapped or deleted.
The base weights are never overwritten."""
from __future__ import annotations

import os
import sys

import torch
import torch.nn as nn

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from store import MemoryStore, _norm  # noqa: E402,F401  (moved to memory/store.py so the serving path needs no torch; re-exported here for training/evolve.py)


class LoRALinear(nn.Module):
    """A frozen linear layer plus a trainable low-rank residual (Delta = B A)."""

    def __init__(self, base: nn.Linear, rank: int = 4, alpha: float = 8.0):
        super().__init__()
        self.base = base
        self.A = nn.Parameter(torch.randn(rank, base.in_features) * 0.02)
        self.B = nn.Parameter(torch.zeros(base.out_features, rank))
        self.scale = alpha / rank

    def forward(self, x):
        return self.base(x) + (x @ self.A.t()) @ self.B.t() * self.scale


def attach_lora(model: nn.Module, rank: int = 4) -> list:
    """Wraps the feed-forward and output linears of the Diffusion Writer; freezes everything else. Returns the trainable parameters."""
    for p in model.parameters():
        p.requires_grad = False
    w = model.core.writer
    for layer in w.layers:
        layer.linear1 = LoRALinear(layer.linear1, rank)
        layer.linear2 = LoRALinear(layer.linear2, rank)
    w.head = LoRALinear(w.head, rank)
    return [p for n, p in model.named_parameters() if n.endswith((".A", ".B"))]


def lora_state(model: nn.Module) -> dict:
    return {n: p.detach().clone() for n, p in model.named_parameters() if n.endswith((".A", ".B"))}


def save_adapter(model: nn.Module, path: str) -> int:
    st = lora_state(model)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    torch.save(st, path)
    return os.path.getsize(path)


def load_adapter(model: nn.Module, path: str, rank: int = 4) -> None:
    attach_lora(model, rank)
    model.load_state_dict(torch.load(path), strict=False)
