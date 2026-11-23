"""One joint objective: causal next-token loss + masked-block T-LDM diffusion loss + MoE balance. Bounded, resumable steps for a CPU trainer."""
from __future__ import annotations

import random

import torch
import torch.nn.functional as F

from .model import Qalam


def joint_loss(model: Qalam, ids: torch.Tensor, tldm_weight: float = 0.15, aux_weight: float = 0.01, block: int = 16,
               cycle_dropout: bool = True, generator: torch.Generator | None = None, z_weight: float = 1e-4,
               loss_mask: torch.Tensor | None = None, segments: torch.Tensor | None = None) -> tuple[torch.Tensor, dict]:
    """`cycle_dropout`: each step runs a random number of cycles, so the model is valid at every depth (this is what makes adaptive depth real)."""
    cyc = random.randint(1, model.cfg.cycles) if cycle_dropout else model.cfg.cycles
    logits, aux = model(ids[:, :-1], cycles=cyc, segments=None if segments is None else segments[:, :-1])
    lf = logits.reshape(-1, logits.shape[-1]).float()
    per = F.cross_entropy(lf, ids[:, 1:].reshape(-1), reduction="none")
    if loss_mask is not None:                                           # train only where it is 1 (e.g. the assistant's tokens, never the user's)
        w = loss_mask[:, 1:].reshape(-1).float()
        causal = (per * w).sum() / w.sum().clamp(min=1.0)
    else:
        causal = per.mean()
    zloss = torch.logsumexp(lf, dim=-1).pow(2).mean()                    # output z-loss: keeps the output logits from drifting
    diffusion = model.tldm_loss(ids, block=min(block, ids.shape[1] - 1), cycles=cyc, generator=generator) if tldm_weight > 0 else causal.new_zeros(())
    total = causal + tldm_weight * diffusion + aux_weight * aux + z_weight * zloss
    return total, {"causal": float(causal.detach()), "tldm": float(diffusion.detach()), "aux": float(aux.detach()), "cycles": cyc}


def train_steps(model: Qalam, batches, steps: int, lr: float = 3e-4, weight_decay: float = 0.01, max_grad_norm: float = 1.0,
                tldm_weight: float = 0.15) -> list[dict]:
    opt = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    model.train()
    log: list[dict] = []
    for _, ids in zip(range(steps), batches):
        opt.zero_grad(set_to_none=True)
        loss, info = joint_loss(model, ids, tldm_weight=tldm_weight)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_grad_norm)
        opt.step()
        log.append(info | {"loss": float(loss.detach())})
    return log
