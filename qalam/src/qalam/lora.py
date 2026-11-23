"""Weight updates that are small, named, mergeable and REVERSIBLE: low-rank adapters on chosen linear layers. The base weights are frozen while an adapter trains,
so a bad update is discarded by deleting the adapter and the base is bit-identical to before (`weights_hash`). Several named adapters can live side by side
(an adapter bank: one per skill or domain) and be switched on with a weight; a good one is merged into the base only after the gate (evolve.py) and a person approve."""
from __future__ import annotations

import hashlib
import math
import re

import torch
from torch import nn

_ADAPTER_KEY = re.compile(r"\.(a|b)\.[^.]+$")          # state_dict keys of adapter parameters: <layer>.a.<name> / <layer>.b.<name>
DEFAULT_TARGETS = r"blocks\.\d+\.(attn\.(q|k|v|o)|moe\.shared\.(gate|up|down))$"
WITH_EXPERTS = r"blocks\.\d+\.(attn\.(q|k|v|o)|moe\.(shared|experts\.\d+)\.(gate|up|down))$"


class LoRALinear(nn.Module):
    def __init__(self, base: nn.Linear) -> None:
        super().__init__()
        self.base = base
        self.a = nn.ParameterDict()
        self.b = nn.ParameterDict()
        self.scale: dict[str, float] = {}
        self.weight_of: dict[str, float] = {}          # how strongly each adapter is switched on (0 = off)

    def add(self, name: str, rank: int, alpha: float) -> None:
        if name in self.a:
            raise ValueError(f"adapter {name!r} already exists")
        i, o = self.base.in_features, self.base.out_features
        a = torch.empty(rank, i, dtype=self.base.weight.dtype, device=self.base.weight.device)
        nn.init.kaiming_uniform_(a, a=math.sqrt(5))
        self.a[name] = nn.Parameter(a)
        self.b[name] = nn.Parameter(torch.zeros(o, rank, dtype=self.base.weight.dtype, device=self.base.weight.device))      # zero: a new adapter changes nothing
        self.scale[name] = alpha / rank
        self.weight_of[name] = 1.0

    def remove(self, name: str) -> None:
        del self.a[name], self.b[name], self.scale[name], self.weight_of[name]

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        y = self.base(x)
        for n in self.a:
            w = self.weight_of[n]
            if w:
                y = y + (w * self.scale[n]) * ((x @ self.a[n].t()) @ self.b[n].t())
        return y

    @torch.no_grad()
    def merge(self, name: str) -> None:
        self.base.weight += self.weight_of[name] * self.scale[name] * (self.b[name] @ self.a[name])
        self.remove(name)


def _targets(model: nn.Module, pattern: str) -> list[tuple[str, nn.Module, str, nn.Module]]:
    rx = re.compile(pattern)
    found = []
    for name, mod in model.named_modules():
        for cname, child in mod.named_children():
            full = f"{name}.{cname}" if name else cname
            if isinstance(child, (nn.Linear, LoRALinear)) and rx.search(full):
                found.append((full, mod, cname, child))
    return found


def attach(model: nn.Module, name: str, rank: int = 8, alpha: float = 16.0, pattern: str = DEFAULT_TARGETS) -> int:
    """Add the adapter `name` to every matching linear layer (wrapping it once). Returns the number of layers."""
    n = 0
    for _, parent, cname, child in _targets(model, pattern):
        layer = child if isinstance(child, LoRALinear) else LoRALinear(child)
        layer.add(name, rank, alpha)
        setattr(parent, cname, layer)
        n += 1
    if not n:
        raise ValueError("no layer matched the adapter pattern")
    return n


def _layers(model: nn.Module) -> list[tuple[str, LoRALinear]]:
    return [(n, m) for n, m in model.named_modules() if isinstance(m, LoRALinear)]


def freeze_base(model: nn.Module) -> None:
    """Only adapter parameters train. (The tied embedding, the router, the norms and every base weight stay fixed.)"""
    adapters = {id(p) for _, m in _layers(model) for p in list(m.a.values()) + list(m.b.values())}
    for p in model.parameters():
        p.requires_grad = id(p) in adapters


def adapter_parameters(model: nn.Module, name: str) -> list[nn.Parameter]:
    out = []
    for _, m in _layers(model):
        if name in m.a:
            out += [m.a[name], m.b[name]]
    return out


def set_active(model: nn.Module, weights: dict[str, float]) -> None:
    """Switch adapters on with a strength; every adapter not named is off."""
    for _, m in _layers(model):
        for n in m.a:
            m.weight_of[n] = float(weights.get(n, 0.0))


def adapter_state(model: nn.Module, name: str) -> dict[str, tuple[torch.Tensor, torch.Tensor]]:
    return {path: (m.a[name].detach().clone(), m.b[name].detach().clone()) for path, m in _layers(model) if name in m.a}


def load_adapter_state(model: nn.Module, name: str, state: dict, alpha: float = 16.0) -> None:
    for path, m in _layers(model):
        if path in state:
            a, b = state[path]
            if name not in m.a:
                m.add(name, a.shape[0], alpha)
            with torch.no_grad():
                m.a[name].copy_(a)
                m.b[name].copy_(b)


def detach(model: nn.Module, name: str) -> None:
    """Discard an adapter (a failed update): the layers keep the wrappers but the base computation is exactly what it was."""
    for _, m in _layers(model):
        if name in m.a:
            m.remove(name)


def merge(model: nn.Module, name: str) -> None:
    """Fold an approved adapter into the base weights."""
    for _, m in _layers(model):
        if name in m.a:
            m.merge(name)


def unwrap(model: nn.Module) -> None:
    """Remove empty wrappers (call after detach / merge) so checkpoints and int8 export see plain linear layers again."""
    for _, parent, cname, child in _targets(model, r".*"):
        if isinstance(child, LoRALinear) and not child.a:
            setattr(parent, cname, child.base)


def weights_hash(model: nn.Module) -> str:
    """Fingerprint of the BASE weights only (adapters excluded): equal before and after a rejected update, proving the rollback is exact."""
    h = hashlib.sha256()
    for n, p in sorted(model.state_dict().items()):
        if _ADAPTER_KEY.search(n):
            continue
        h.update(n.replace(".base.", ".").encode())
        h.update(p.detach().cpu().contiguous().numpy().tobytes())
    return h.hexdigest()
