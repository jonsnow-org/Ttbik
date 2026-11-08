"""
Sham — PACKS: a small fast core + add-on files, like an APK + OBB ("نواة + حزم").

The core checkpoint is never touched. What is added lives in separate files that can be installed, swapped and removed:

  knowledge pack   texts + a compressed BM25 index (sham_kb). Needs no training of the core to install; the model reads it through the search tool.
  memory pack      a sparse key->value memory (sham_memory_layer.ProductKeyMemory) attached to ONE block's output through a forward hook. Its values start at
                   ZERO, so with the pack attached but untrained the core computes exactly what it did before. Only the pack's tensors are saved.
  lora pack        low-rank adapters on chosen Linear layers (B starts at zero for the same reason). Only the adapters are saved.

A memory/lora pack must be TRAINED against the core it plugs into (the core stays frozen; the pack alone gets gradients). A pack records which core it was
trained for (d_model, layers, a fingerprint of the core's weights) and refuses to load into another.

Works with Sham's own `ShamSmall` and with Hugging Face decoder models (the hook accepts a tensor or a tuple, the Linear wrappers need only `nn.Linear`).
"""
from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F

from sham_kb import KnowledgeBase
from sham_memory_layer import ProductKeyMemory

FORMAT = 1


def core_fingerprint(model: nn.Module, d_model: int, n_layers: int) -> dict:
    """Small identity of the core: shape numbers + a hash of a few weight values (cheap, stable across save/load)."""
    h = hashlib.sha256()
    for name, p in sorted(model.named_parameters())[:6]:
        h.update(name.encode())
        h.update(p.detach().flatten()[:64].float().cpu().numpy().tobytes())
    return {"d_model": d_model, "n_layers": n_layers, "hash": h.hexdigest()[:16]}


# ---------------------------------------------------------------- memory pack

class MemoryPack(nn.Module):
    """x -> x + memory(x); the memory's values start at zero so the core is unchanged until the pack is trained."""

    def __init__(self, d_model: int, n_keys: int = 64, topk: int = 4, heads: int = 2, key_dim: int = 32):
        super().__init__()
        self.mem = ProductKeyMemory(d_model, n_keys, topk, heads, key_dim)
        nn.init.zeros_(self.mem.values.weight)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.mem(x)


def attach_memory_pack(block: nn.Module, pack: MemoryPack):
    """Forward hook on a decoder block: output hidden state += memory(output). Returns the handle (handle.remove() detaches the pack)."""
    def hook(_module, _inputs, out):
        if isinstance(out, tuple):
            return (pack(out[0]),) + tuple(out[1:])
        return pack(out)
    return block.register_forward_hook(hook)


# ---------------------------------------------------------------- lora pack

class LoRALinear(nn.Module):
    def __init__(self, base: nn.Linear, rank: int = 8, alpha: float | None = None):
        super().__init__()
        self.base = base
        self.rank = rank
        self.scale = (alpha if alpha is not None else rank) / rank
        self.down = nn.Parameter(torch.randn(rank, base.in_features) * base.in_features ** -0.5)
        self.up = nn.Parameter(torch.zeros(base.out_features, rank))

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.base(x) + F.linear(F.linear(x, self.down.to(x.dtype)), self.up.to(x.dtype)) * self.scale


def attach_lora(model: nn.Module, pattern: str = r"mlp\.down_proj$", rank: int = 8) -> list[str]:
    """Wrap every Linear whose dotted name matches `pattern`. Returns the wrapped names (the pack's keys)."""
    done = []
    for parent_name, parent in list(model.named_modules()):
        for child_name, child in list(parent.named_children()):
            full = f"{parent_name}.{child_name}" if parent_name else child_name
            if isinstance(child, nn.Linear) and re.search(pattern, full):
                setattr(parent, child_name, LoRALinear(child, rank))
                done.append(full)
    return done


# ---------------------------------------------------------------- saving / loading the add-on files

def _pack_tensors(module_map: dict[str, nn.Module]) -> dict[str, torch.Tensor]:
    out = {}
    for key, m in module_map.items():
        for n, p in m.state_dict().items():
            if isinstance(m, LoRALinear) and not n.startswith(("down", "up")):
                continue                                  # the frozen base layer is part of the core, not of the pack
            out[f"{key}::{n}"] = p.detach().to(torch.float16).cpu()
    return out


def save_weight_pack(directory: str | Path, name: str, kind: str, module_map: dict[str, nn.Module], core: dict, extra: dict | None = None) -> int:
    """Writes pack.json + weights.pt (fp16). Returns the size of weights.pt in bytes."""
    d = Path(directory)
    d.mkdir(parents=True, exist_ok=True)
    torch.save(_pack_tensors(module_map), d / "weights.pt")
    (d / "pack.json").write_text(json.dumps({"format": FORMAT, "name": name, "kind": kind, "core": core, "keys": sorted(module_map), **(extra or {})}, indent=1))
    return (d / "weights.pt").stat().st_size


def load_weight_pack(directory: str | Path, module_map: dict[str, nn.Module], core: dict) -> dict:
    """Loads the tensors into the (already attached) modules. Refuses a pack made for another core."""
    d = Path(directory)
    meta = json.loads((d / "pack.json").read_text())
    for field in ("d_model", "n_layers", "hash"):
        if meta["core"].get(field) != core.get(field):
            raise ValueError(f"pack {meta['name']!r} was trained for another core ({field}: {meta['core'].get(field)} != {core.get(field)})")
    tensors = torch.load(d / "weights.pt", map_location="cpu")
    for key, m in module_map.items():
        sd = {n.split("::", 1)[1]: t.float() for n, t in tensors.items() if n.startswith(key + "::")}
        m.load_state_dict(sd, strict=not isinstance(m, LoRALinear))
    return meta


def write_knowledge_pack(directory: str | Path, name: str, texts: list[str], core_tokenizer: str = "") -> dict:
    d = Path(directory)
    d.mkdir(parents=True, exist_ok=True)
    kb = KnowledgeBase().build(texts)
    size = kb.save(d / "library.kb")
    stats = kb.stats()
    (d / "pack.json").write_text(json.dumps({"format": FORMAT, "name": name, "kind": "knowledge", "stats": stats, "bytes": size, "tokenizer": core_tokenizer}, indent=1))
    return {"bytes": size, **stats}


def load_knowledge_pack(directory: str | Path) -> KnowledgeBase:
    return KnowledgeBase.load(Path(directory) / "library.kb")


def pack_bytes(directory: str | Path) -> int:
    return sum(f.stat().st_size for f in Path(directory).iterdir() if f.is_file())


# ---------------------------------------------------------------- self-test

def _selftest() -> None:
    import tempfile

    class Block(nn.Module):
        def __init__(self, d):
            super().__init__()
            self.lin = nn.Linear(d, d)
            self.mlp = nn.Sequential()
            self.mlp.down_proj = nn.Linear(d, d)

        def forward(self, x):
            return (x + self.mlp.down_proj(torch.tanh(self.lin(x))), None)

    class Core(nn.Module):
        def __init__(self, d=16, n=3):
            super().__init__()
            self.layers = nn.ModuleList(Block(d) for _ in range(n))

        def forward(self, x):
            for b in self.layers:
                x = b(x)[0]
            return x

    torch.manual_seed(0)
    core = Core()
    for p in core.parameters():
        p.requires_grad_(False)
    x = torch.randn(2, 5, 16)
    y0 = core(x)
    fp = core_fingerprint(core, 16, 3)

    pack = MemoryPack(16, n_keys=8, topk=2, heads=2, key_dim=8)
    h = attach_memory_pack(core.layers[1], pack)
    assert torch.allclose(core(x), y0), "an untrained memory pack must not change the core"
    opt = torch.optim.SGD(pack.parameters(), lr=0.5)
    for _ in range(5):
        loss = ((core(x) - y0 - 1.0) ** 2).mean()
        opt.zero_grad()
        loss.backward()
        opt.step()
    y1 = core(x)
    assert not torch.allclose(y1, y0), "a trained pack must change the output"
    assert all(p.grad is None or not p.requires_grad or True for p in core.parameters())
    with tempfile.TemporaryDirectory() as td:
        n = save_weight_pack(td, "t", "memory", {"l1": pack}, fp)
        pack2 = MemoryPack(16, n_keys=8, topk=2, heads=2, key_dim=8)
        h.remove()
        h2 = attach_memory_pack(core.layers[1], pack2)
        load_weight_pack(td, {"l1": pack2}, fp)
        assert torch.allclose(core(x), y1, atol=1e-2), "reloaded pack must reproduce the trained behaviour (fp16 rounding)"
        h2.remove()
        assert torch.allclose(core(x), y0), "removing the pack restores the core exactly"
        bad = dict(fp, hash="deadbeef")
        try:
            load_weight_pack(td, {"l1": pack2}, bad)
            raise AssertionError("must refuse another core")
        except ValueError:
            pass
        assert n > 0
    names = attach_lora(core, r"mlp\.down_proj$", rank=2)
    assert len(names) == 3 and torch.allclose(core(x), y0, atol=1e-6), "an untrained lora pack must not change the core"
    with tempfile.TemporaryDirectory() as td:
        info = write_knowledge_pack(td, "k", ["القاهرة عاصمة مصر وأكبر مدنها. " * 20, "Paris is the capital of France. " * 20])
        kb = load_knowledge_pack(td)
        assert kb.search("عاصمة مصر", 1) and info["ratio"] > 1.5
    print("sham_packs self-test OK")


if __name__ == "__main__":
    _selftest()
