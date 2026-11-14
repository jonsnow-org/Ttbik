"""Bridge from the Sham Intelligence Lab (intelligence_lab/, designed by the owner's lab session, PR #894) to Sham v1 and Sham v2 training.

The lab stays standalone (stdlib only, imports nothing from Sham). This module is the ONLY place that connects it, and only through (question, answer) pairs, the shape both
Shams already train on (v1: sham_chat._chat_plan source "sil"; v2: sham_v2_train.arabic_replay_pairs). What passes through, and what does not:

  * only synthetic records the lab's own verifier PASSED (an arithmetic/evidence/repair answer is checked, not trusted);
  * teacher records are NEVER used here (owner's data policy: no training on commercial-model outputs; the lab quarantines them anyway) unless SHAM_SIL_ALLOW_TEACHER=1 AND the
    record is reviewed=true and verification_status=passed;
  * plain arithmetic direct-answer pairs are skipped by default (sham_reasoning_data already teaches worked arithmetic with steps; an answer-only pair would teach guessing):
    SHAM_SIL_ARITH=1 brings them back; `uncertainty` pairs wait for the owner's wording review (SHAM_SIL_TASKS=reasoning,evidence,repair,uncertainty);
  * a FIXED held-out set (FROZEN_SEED) is generated once and never trained on: every training pair whose prompt is in it is dropped, so the set stays a yardstick (`heldout_rows`).
SHAM_SIL=0 turns the whole bridge off.
"""
from __future__ import annotations

import os
import random
import sys
from pathlib import Path

LAB_SRC = Path(__file__).resolve().parent / "intelligence_lab" / "src"
FROZEN_SEED = 20261112          # the held-out set: generated with this seed, never trained on
DEFAULT_TASKS = ("reasoning", "evidence", "repair")


def enabled() -> bool:
    return os.environ.get("SHAM_SIL", "1").strip().lower() not in ("0", "off", "false", "no")


def _lab():
    if str(LAB_SRC) not in sys.path:
        sys.path.insert(0, str(LAB_SRC))
    from sham_intelligence_lab.generators import generate_curriculum
    from sham_intelligence_lab.distillation import verify_example as verify
    return generate_curriculum, verify


def _tasks() -> set[str]:
    raw = os.environ.get("SHAM_SIL_TASKS", "")
    return {t.strip() for t in raw.split(",") if t.strip()} or set(DEFAULT_TASKS)


def _key(prompt: str) -> str:
    return " ".join(prompt.split())


def _allowed(ex, tasks: set[str]) -> bool:
    if ex.task not in tasks:
        return False
    if ex.source_kind == "teacher":
        md = ex.metadata or {}
        if os.environ.get("SHAM_SIL_ALLOW_TEACHER") != "1" or not (md.get("reviewed") is True and md.get("verification_status") == "passed"):
            return False
    if ex.verifier == "safe_arithmetic" and os.environ.get("SHAM_SIL_ARITH") != "1":
        return False
    return True


def heldout_rows(count_per_task: int = 100) -> list[dict]:
    """The fixed yardstick: verified examples of every task, generated from FROZEN_SEED. Never trained on."""
    gen, verify = _lab()
    out = []
    for ex in gen(FROZEN_SEED, count_per_task):
        v = verify(ex)
        out.append({"prompt": ex.prompt, "target": ex.target, "task": ex.task, "verifier": ex.verifier, "passed": v.get("passed")})
    return out


def train_pairs(n: int, seed: int, count_per_task: int = 300) -> list[tuple[str, str]]:
    """Up to n (question, answer) pairs for training; deterministic for a seed; [] when the bridge is off or the lab is missing."""
    if not enabled() or n <= 0:
        return []
    try:
        gen, verify = _lab()
        frozen = {_key(e.prompt) for e in gen(FROZEN_SEED, 100)}
        tasks = _tasks()
        pairs, seen = [], set()
        for ex in gen(seed, count_per_task):
            if not _allowed(ex, tasks):
                continue
            k = _key(ex.prompt)
            if k in frozen or k in seen:
                continue
            if verify(ex).get("passed") is not True:        # only answers the lab's own verifier confirmed
                continue
            seen.add(k)
            pairs.append((ex.prompt.strip(), ex.target.strip()))
        random.Random(seed).shuffle(pairs)
        return pairs[:n]
    except Exception as exc:  # noqa: BLE001 - a missing lab must never stop a training run
        print(f"SIL bridge: skipped ({type(exc).__name__}: {str(exc)[:100]})", flush=True)
        return []


class PairSource:
    """Looks like the small slice of a `datasets.Dataset` that sham_chat.load_arabic_dialogues uses: len() and select(range)."""

    def __init__(self, rows: list[dict]):
        self.rows = rows

    def __len__(self) -> int:
        return len(self.rows)

    def select(self, idx):
        return [self.rows[i] for i in idx]

    def filter(self, fn):
        return PairSource([r for r in self.rows if fn(r)])


def chat_source(seed: int = 0, size: int = 8000, count_per_task: int = 1000) -> PairSource:
    """The loader of the chat plan's `sil` source (columns prompt / target): a fixed, deterministic pool the plan walks through epoch by epoch."""
    return PairSource([{"prompt": q, "target": a} for q, a in train_pairs(size, seed, count_per_task)])


def _selftest() -> None:
    rows = heldout_rows(20)
    assert rows and all(r["passed"] is not False for r in rows)
    frozen = {_key(r["prompt"]) for r in heldout_rows(100)}
    pairs = train_pairs(200, 7)
    assert pairs, "the bridge produced no training pairs"
    assert not any(_key(q) in frozen for q, _ in pairs), "a held-out prompt leaked into training"
    assert train_pairs(200, 7) == pairs, "not deterministic"
    os.environ["SHAM_SIL"] = "0"
    assert train_pairs(10, 7) == []
    os.environ.pop("SHAM_SIL")
    print(f"sham_sil_bridge self-test OK: {len(pairs)} pairs, {len(frozen)} frozen held-out prompts, tasks {sorted({r['task'] for r in rows})}")


if __name__ == "__main__":
    _selftest()
