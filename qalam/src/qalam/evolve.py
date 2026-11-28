"""The self-improvement cycle: experience -> curriculum -> a candidate adapter trained on a sandbox copy -> an evaluation GATE -> promotable or discarded.
The gate needs two held-out suites (each at its Wilson lower bound above the floor) and no regression on any protected suite; a rejected candidate is
deleted and the base weights are proven bit-identical (`lora.weights_hash`). Promotion into the model additionally needs a person's approval
(governance.classify). Every cycle appends a line to the lineage file. This module is protected: the model does not edit its own gate."""
from __future__ import annotations

import hashlib
import json
import math
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import torch

from . import governance, lora
from .data import Record, admit


# ------------------------------------------------------------------------------------------------------- experience
@dataclass(frozen=True)
class Experience:
    task: str
    response: str
    verified: bool            # an executor (tests, a file check, a command's exit code) said yes - never the model itself
    verifier: str
    user: str = ""
    provenance: str = "executor_verified"
    consent: bool = False     # the person agreed that this exchange may be learned from; without it nothing enters the log


class ExperienceLog:
    """Only CONSENTED, verified successes enter, with the user replaced by a salted one-way pseudonym (the raw id is never stored), deduplicated, and capped per
    user so one person cannot steer the model. `forget_user` deletes everything one person contributed (the right to be forgotten)."""

    def __init__(self, per_user_cap: int = 50, salt: str = "") -> None:
        self.items: list[Experience] = []
        self.cap = per_user_cap
        self._salt = salt or hashlib.sha256(str(time.time_ns()).encode()).hexdigest()
        self._seen: set[str] = set()
        self._count: dict[str, int] = {}
        self._keys: dict[str, str] = {}                               # pseudonym -> dedup key of its items (to free them on forget)

    def pseudonym(self, user: str) -> str:
        return hashlib.sha256((self._salt + "|" + user).encode()).hexdigest()[:16] if user else ""

    def forget_user(self, user: str) -> int:
        who = self.pseudonym(user)
        gone = [e for e in self.items if e.user == who]
        self.items = [e for e in self.items if e.user != who]
        self._count.pop(who, None)
        for e in gone:
            self._seen.discard(hashlib.sha256((e.task.strip().lower() + "\x00" + e.response.strip()).encode()).hexdigest())
        return len(gone)

    def add(self, e: Experience) -> tuple[bool, str]:
        if not e.consent:
            return False, "no consent to learn from this exchange"
        if not e.verified or not e.verifier:
            return False, "not verified by an executor"
        e = Experience(e.task, e.response, e.verified, e.verifier, self.pseudonym(e.user), e.provenance, True)
        ok, why = admit(Record(e.task + "\n" + e.response, "experience", e.provenance, "owner"))
        if not ok:
            return False, why
        key = hashlib.sha256((e.task.strip().lower() + "\x00" + e.response.strip()).encode()).hexdigest()
        if key in self._seen:
            return False, "duplicate"
        if self._count.get(e.user, 0) >= self.cap:
            return False, "per-user cap reached"
        self._seen.add(key)
        self._count[e.user] = self._count.get(e.user, 0) + 1
        self.items.append(e)
        return True, "ok"

    def curriculum(self, rewordings: Callable[[str], list[str]] | None = None, variants: int = 3) -> list[tuple[str, str]]:
        """(prompt, target) pairs: each verified success, plus rewordings of its task so the lesson is not tied to one phrasing."""
        out: list[tuple[str, str]] = []
        for e in self.items:
            out.append((e.task, e.response))
            if rewordings:
                out += [(t, e.response) for t in rewordings(e.task)[:variants]]
        return out


# ------------------------------------------------------------------------------------------------------- the gate
def wilson_lower(successes: int, n: int, z: float = 1.96) -> float:
    if n <= 0:
        return 0.0
    p = successes / n
    d = 1 + z * z / n
    return (p + z * z / (2 * n) - z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / d


@dataclass
class GateResult:
    passed: bool
    reasons: list[str] = field(default_factory=list)
    stats: dict = field(default_factory=dict)


def gate(candidate: dict[str, tuple[int, int]], baseline: dict[str, tuple[int, int]], held: list[str], regression: list[str],
         floor: float = 0.6, max_regression: float = 0.02) -> GateResult:
    """candidate / baseline: suite -> (successes, n). Passes only if (1) at least two held-out suites exist, each improving on the baseline with a Wilson
    lower bound >= floor, and (2) no regression suite falls more than `max_regression` below its baseline rate."""
    res = GateResult(True)
    rate = lambda d, k: d[k][0] / d[k][1] if d[k][1] else 0.0   # noqa: E731
    if len(held) < 2:
        res.passed = False
        res.reasons.append("two held-out suites are required")
    for s in held:
        lo = wilson_lower(*candidate[s])
        res.stats[s] = {"baseline": round(rate(baseline, s), 3), "candidate": round(rate(candidate, s), 3), "wilson_lower": round(lo, 3)}
        if rate(candidate, s) <= rate(baseline, s):
            res.passed = False
            res.reasons.append(f"{s}: no improvement over the baseline")
        if lo < floor:
            res.passed = False
            res.reasons.append(f"{s}: Wilson lower bound {lo:.2f} below the floor {floor}")
    for s in regression:
        b, c = rate(baseline, s), rate(candidate, s)
        res.stats[s] = {"baseline": round(b, 3), "candidate": round(c, 3)}
        if c < b - max_regression:
            res.passed = False
            res.reasons.append(f"{s}: regressed from {b:.2f} to {c:.2f}")
    return res


# ------------------------------------------------------------------------------------------------------- the cycle
@dataclass
class CycleResult:
    status: str                       # "rejected" | "promotable" | "promoted" | "refused" | "stopped"
    gate: GateResult | None
    adapter: str
    reasons: list[str]
    parent_hash: str
    needs_approval: bool = False
    state_path: str = ""
    snapshot_path: str = ""           # the exact base weights before the merge (for an exact revert)
    new_hash: str = ""


def self_improve_cycle(model: torch.nn.Module, curriculum: list, *, train_fn: Callable, eval_fn: Callable[[torch.nn.Module, str], tuple[int, int]],
                       held: list[str], regression: list[str], adapter: str, lineage_dir: str | Path, steps: int = 200, rank: int = 8,
                       floor: float = 0.6, max_regression: float = 0.02, replay: list | None = None,
                       auto_promote: bool = True, audit=None, stop=None) -> CycleResult:
    """Train a candidate adapter on a sandbox copy of the knowledge, evaluate it against the baseline, and either keep it as `promotable` (still not live)
    or delete it. `train_fn(model, params, curriculum, steps)` and `eval_fn(model, suite)` belong to the caller. `replay` is examples of what the model must
    NOT forget (the protected skills): they are mixed into the training set. Without replay a new skill usually overwrites old ones, and the gate then
    rejects the candidate (tested)."""
    v = governance.classify("adapter_train", amount=steps)
    parent = lora.weights_hash(model)
    if not v.allowed:
        return CycleResult("refused", None, adapter, [v.reason], parent)
    if stop is not None and stop.engaged():
        return CycleResult("stopped", None, adapter, ["emergency stop engaged"], parent)
    suites = held + [s for s in regression if s not in held]
    model.eval()
    baseline = {s: eval_fn(model, s) for s in suites}                       # adapters (if any) off for the baseline
    lora.attach(model, adapter, rank=rank)
    trainable_before = lora.freeze_base(model)
    try:
        train_fn(model, lora.adapter_parameters(model, adapter), list(curriculum) + list(replay or []), steps)
        model.eval()
        lora.set_active(model, {adapter: 1.0})
        cand = {s: eval_fn(model, s) for s in suites}
    except Exception:
        lora.detach(model, adapter)
        lora.unwrap(model)
        lora.restore_trainable(model, trainable_before)
        raise
    g = gate(cand, baseline, held, regression, floor, max_regression)
    lineage = Path(lineage_dir)
    lineage.mkdir(parents=True, exist_ok=True)
    rec = {"time": time.time(), "adapter": adapter, "parent_weights": parent, "steps": steps, "curriculum": len(curriculum), "replay": len(replay or []), "passed": g.passed,
           "reasons": g.reasons, "stats": g.stats}
    if g.passed:
        path = lineage / f"{adapter}.pt"
        torch.save(lora.adapter_state(model, adapter), path)
        lora.set_active(model, {})
        res = CycleResult("promotable", g, adapter, [], parent, state_path=str(path))
        rec["state"] = str(path)
        if auto_promote and governance.classify("adapter_promote", gate_passed=True).allowed:        # owner decision 2026-11-23: the fixed metrics decide, no human click
            res.new_hash = promote(model, res, lineage_dir=lineage)
            res.status = "promoted"
            res.snapshot_path = str(lineage / f"{adapter}.parent.pt")
            rec.update(promoted=True, snapshot=res.snapshot_path, new_hash=res.new_hash)
    else:
        lora.detach(model, adapter)
        lora.unwrap(model)
        assert lora.weights_hash(model) == parent, "rollback changed the base weights"
        res = CycleResult("rejected", g, adapter, g.reasons, parent)
    lora.restore_trainable(model, trainable_before)                         # the base weights are trainable again exactly as they were before the cycle
    with open(lineage / "lineage.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps(rec, sort_keys=True) + "\n")
    if audit is not None:
        audit.append("self_improve_cycle", adapter=adapter, status=res.status, parent=parent, new=res.new_hash, reasons=res.reasons, stats=g.stats)
    return res


def promote(model: torch.nn.Module, result: CycleResult, approved: bool | None = None, lineage_dir: str | Path | None = None) -> str:
    """Merge a candidate that PASSED THE GATE into the base weights (no human approval is needed: owner decision 2026-11-23). The exact pre-merge weights of the touched
    layers are saved first, so `revert` restores them bit for bit. A candidate that did not pass can never be promoted. Returns the new weights hash."""
    if result.status not in ("promotable", "promoted") or result.gate is None or not result.gate.passed:
        raise PermissionError("only a candidate that passed the gate can be promoted")
    v = governance.classify("adapter_promote", gate_passed=True)
    if not v.allowed:
        raise PermissionError(v.reason)
    snap = {path: m.base.weight.detach().clone() for path, m in lora._layers(model) if result.adapter in m.a}
    folder = Path(lineage_dir) if lineage_dir else Path(result.state_path).parent
    torch.save(snap, folder / f"{result.adapter}.parent.pt")
    lora.set_active(model, {result.adapter: 1.0})
    lora.merge(model, result.adapter)
    lora.unwrap(model)
    return lora.weights_hash(model)


def revert(model: torch.nn.Module, lineage_dir: str | Path, audit=None) -> str:
    """The 'back to the last trusted point' button: undo the most recent promotion that is still in force, exactly. Returns the restored weights hash."""
    lineage = Path(lineage_dir)
    recs = [json.loads(x) for x in (lineage / "lineage.jsonl").read_text(encoding="utf-8").splitlines() if x.strip()]
    reverted = {r["adapter"] for r in recs if r.get("reverted")}
    live = [r for r in recs if r.get("promoted") and r["adapter"] not in reverted]
    if not live:
        raise ValueError("no promotion to revert")
    last = live[-1]
    snap = torch.load(last["snapshot"], weights_only=True)
    mods = dict(model.named_modules())
    with torch.no_grad():
        for path, w in snap.items():
            mods[path].weight.copy_(w)
    h = lora.weights_hash(model)
    with open(lineage / "lineage.jsonl", "a", encoding="utf-8") as f:
        f.write(json.dumps({"time": time.time(), "adapter": last["adapter"], "reverted": True, "restored_hash": h}, sort_keys=True) + "\n")
    if audit is not None:
        audit.append("revert", adapter=last["adapter"], restored=h)
    return h
