"""Per-task-cluster LoRA adapters inside ONE model (not routing between models): the base weights stay frozen; each task family (inspect / count /
search_sort / write ...) gets its own low-rank delta; a router picks the family of a task from the model's own frozen reader features; candidate adapters
pass a no-regression gate before they become active; every version is kept on disk with its metrics and can be rolled back.

    wrap(model)                                   # once: MultiLoRALinear around the writer's feed-forward/output layers and the reader projection
    add_adapter(model, "count", rank=8)           # new trainable delta (zeros: the model is unchanged until trained)
    set_active(model, "count") / set_active(model, None)
    st = adapter_state(model, "count"); load_adapter(model, "count", st)
    merged = merge([st1, st2], [0.5, 0.5]); small = compress(merged, rank=8)   # exact merge by rank concatenation, SVD prune
    reg = AdapterRegistry(dir); vid = reg.propose("count", st, metrics); reg.accept("count", vid) / reg.reject(...) / reg.rollback("count")
    router = Router(embed_fn); router.fit(tasks, families); router.route(task) -> (family, similarity)
    gate(before, after, target) -> (accepted: bool, why: str)
"""
from __future__ import annotations

import json
import os
import time

import torch
import torch.nn as nn


class MultiLoRALinear(nn.Module):
    def __init__(self, base: nn.Linear, alpha: float = 16.0):
        super().__init__()
        self.base, self.alpha = base, alpha
        self.A = nn.ParameterDict()
        self.B = nn.ParameterDict()
        self.active: str | None = None

    @property
    def in_features(self):
        return self.base.in_features

    @property
    def out_features(self):
        return self.base.out_features

    @property
    def weight(self):                                              # nn.TransformerDecoderLayer reads .weight in some code paths
        return self.base.weight

    @property
    def bias(self):
        return self.base.bias

    def add(self, name: str, rank: int) -> None:
        self.A[name] = nn.Parameter(torch.randn(rank, self.base.in_features) * 0.01)
        self.B[name] = nn.Parameter(torch.zeros(self.base.out_features, rank))

    def forward(self, x):
        y = self.base(x)
        n = self.active
        if n is not None and n in self.A:
            A, B = self.A[n], self.B[n]
            y = y + (x @ A.t()) @ B.t() * (self.alpha / A.shape[0])
        return y


def _targets(model):
    core = model.core
    out = []
    for i, layer in enumerate(core.writer.layers):
        out += [(layer, "linear1"), (layer, "linear2")]
    out.append((core.writer, "head"))
    if hasattr(model, "proj"):
        out.append((model, "proj"))
    return out


def wrap(model) -> list:
    for p in model.parameters():
        p.requires_grad = False
    mods = []
    for parent, attr in _targets(model):
        m = getattr(parent, attr)
        if not isinstance(m, MultiLoRALinear):
            m = MultiLoRALinear(m)
            setattr(parent, attr, m)
        mods.append(m)
    return mods


def lora_modules(model) -> list:
    return [m for m in model.modules() if isinstance(m, MultiLoRALinear)]


def add_adapter(model, name: str, rank: int = 8) -> list:
    params = []
    for m in lora_modules(model) or wrap(model):
        m.add(name, rank)
        params += [m.A[name], m.B[name]]
    return params


def set_active(model, name: str | None) -> None:
    for m in lora_modules(model):
        m.active = name


def adapter_state(model, name: str) -> list:
    return [(m.A[name].detach().clone(), m.B[name].detach().clone()) for m in lora_modules(model)]


def load_adapter(model, name: str, state: list) -> None:
    mods = lora_modules(model) or wrap(model)
    for m, (A, B) in zip(mods, state):
        m.A[name] = nn.Parameter(A.clone(), requires_grad=False)
        m.B[name] = nn.Parameter(B.clone(), requires_grad=False)


def drop_adapter(model, name: str) -> None:
    for m in lora_modules(model):
        if name in m.A:
            del m.A[name]
            del m.B[name]
        if m.active == name:
            m.active = None


def merge(states: list, weights: list) -> list:
    """Exact: sum_i w_i * (B_i A_i) / r_i, written as ONE adapter of rank sum r_i (the scale alpha/r is folded into B)."""
    out = []
    for parts in zip(*states):
        R = sum(A.shape[0] for A, _ in parts)
        As = torch.cat([A for A, _ in parts], 0)
        Bs = torch.cat([B * w * (R / A.shape[0]) for (A, B), w in zip(parts, weights)], 1)
        out.append((As, Bs))
    return out


def compress(state: list, rank: int) -> list:
    """Prunes an adapter to `rank` by SVD of each delta (keeps the largest directions); same scale convention."""
    out = []
    for A, B in state:
        R = A.shape[0]
        delta = (B @ A) / R                                          # the actual delta divided by alpha
        U, S, Vh = torch.linalg.svd(delta, full_matrices=False)
        r = min(rank, S.shape[0])
        out.append((Vh[:r].contiguous(), (U[:, :r] * S[:r]).contiguous() * r))
    return out


def size_bytes(state: list) -> int:
    return sum(A.numel() + B.numel() for A, B in state) * 4


class AdapterRegistry:
    """<root>/manifest.json + <root>/<family>/<version>.pt. Nothing is ever overwritten; rollback moves the active pointer back."""

    def __init__(self, root: str):
        self.root = root
        os.makedirs(root, exist_ok=True)
        self.path = os.path.join(root, "manifest.json")
        self.m = json.load(open(self.path)) if os.path.exists(self.path) else {"clusters": {}}

    def _save(self):
        tmp = self.path + ".tmp"
        json.dump(self.m, open(tmp, "w"), indent=1)
        os.replace(tmp, self.path)

    def propose(self, fam: str, state: list, metrics: dict, parent: str | None = None) -> str:
        c = self.m["clusters"].setdefault(fam, {"active": None, "history": [], "versions": []})
        vid = f"v{len(c['versions']) + 1}"
        os.makedirs(os.path.join(self.root, fam), exist_ok=True)
        path = os.path.join(self.root, fam, vid + ".pt")
        torch.save(state, path)
        c["versions"].append({"id": vid, "parent": parent or c["active"], "path": os.path.relpath(path, self.root), "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
                              "metrics": metrics, "status": "proposed", "bytes": os.path.getsize(path)})
        self._save()
        return vid

    def _v(self, fam, vid):
        return next(v for v in self.m["clusters"][fam]["versions"] if v["id"] == vid)

    def accept(self, fam: str, vid: str, why: str = "") -> None:
        c = self.m["clusters"][fam]
        if c["active"]:
            c["history"].append(c["active"])
        c["active"] = vid
        self._v(fam, vid).update(status="accepted", why=why)
        self._save()

    def reject(self, fam: str, vid: str, why: str = "") -> None:
        self._v(fam, vid).update(status="rejected", why=why)
        self._save()

    def rollback(self, fam: str) -> str | None:
        c = self.m["clusters"][fam]
        if c["active"]:
            self._v(fam, c["active"])["status"] = "rolled_back"
        c["active"] = c["history"].pop() if c["history"] else None
        self._save()
        return c["active"]

    def active(self) -> dict:
        return {f: c["active"] for f, c in self.m["clusters"].items() if c["active"]}

    def load(self, fam: str, vid: str | None = None) -> list:
        vid = vid or self.m["clusters"][fam]["active"]
        return torch.load(os.path.join(self.root, self._v(fam, vid)["path"]))

    def install(self, model) -> dict:
        """Loads every active adapter into the model under its family name. -> {family: version}."""
        act = self.active()
        for fam, vid in act.items():
            load_adapter(model, fam, self.load(fam, vid))
        return act


class Router:
    """Task type from the model's own frozen reader: nearest family centroid of the (normalised, mean-pooled) features of tasks whose family is known."""

    def __init__(self, embed_fn, min_sim: float = 0.0):
        self.embed_fn, self.min_sim = embed_fn, min_sim
        self.names, self.C = [], None
        self.X, self.y = None, []

    def fit(self, tasks: list, fams: list) -> None:
        X = torch.nn.functional.normalize(self.embed_fn(tasks), dim=-1)
        self.X, self.y = X, list(fams)

    def route(self, tasks: list, k: int = 5) -> list:
        Q = torch.nn.functional.normalize(self.embed_fn(tasks), dim=-1)
        S = Q @ self.X.t()
        out = []
        for row in S:
            v, i = row.topk(min(k, row.shape[0]))
            votes: dict = {}
            for s, j in zip(v.tolist(), i.tolist()):
                votes[self.y[j]] = votes.get(self.y[j], 0.0) + s
            fam = max(votes, key=votes.get)
            out.append((fam if v[0].item() >= self.min_sim else None, round(v[0].item(), 3)))
        return out


def gate(before: dict, after: dict, target: str, keep_sets: tuple, max_lost=0.0) -> tuple:
    """before/after: {set_name: {item_id: bool}}. Accepted only if (1) on every keep set the total does NOT drop (no net regression) and at most `max_lost`
    items (an int, or a fraction of the set when < 1; or a dict {set: tolerance}) that were right before are now wrong, and (2) the target set strictly improves."""
    for s in keep_sets:
        lost = sum(1 for k, v in before[s].items() if v and not after[s].get(k, False))
        tol = max_lost.get(s, 0) if isinstance(max_lost, dict) else max_lost
        allow = tol * len(before[s]) if 0 < tol < 1 else tol
        if lost > allow or sum(after[s].values()) < sum(before[s].values()):
            return False, f"regression on {s}: {lost} previously-correct item(s) lost ({sum(before[s].values())} -> {sum(after[s].values())})"
    b, a = sum(before[target].values()), sum(after[target].values())
    if a <= b:
        return False, f"no gain on target {target} ({b} -> {a})"
    return True, f"gain on {target} {b} -> {a}, no regression on {', '.join(keep_sets)}"
