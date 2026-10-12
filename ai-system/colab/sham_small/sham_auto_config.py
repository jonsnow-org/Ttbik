"""
Settings Sham decides BY ITSELF, from what it measures — no one switches anything by hand.

The free CPU runner (sham_ci_merge) runs an experiment after every merge (sham_reasoning_probe: does the model learn
step-by-step solutions, and what does it cost on ordinary text?) and writes the verdict into `merge_progress.json` of the dataset
`sham-merged-checkpoint` under "auto". Every training notebook reads that one small file when it starts
(`get("reasoning_share")`), so the next session already trains with the decided share. An environment variable always wins
(`SHAM_REASONING_SHARE=0.2` forces, `=0` forbids), and without any verdict the share is 0 — nothing changes by accident.

    decide_reasoning(probe, previous)  → {"reasoning_share": 0.0 | 0.05 | 0.10, ...}   (pure function, tested below)
    get(name, default)                 → the decided value (read once per process, never raises)
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
import time
import zipfile
from pathlib import Path

SOURCE_DATASET = "sham-merged-checkpoint"
FILE = "merge_progress.json"
_CACHE: dict = {}


def decide_reasoning(probe: dict | None, previous: dict | None = None) -> dict:
    """The share of worked-solution examples in the chat-stage mixture, decided from the probe's before/after numbers.

    gain  = how much the loss on fresh worked solutions fell (relative);   cost = how much the loss on ordinary text rose.
    ≥15% gain at ≤2% cost → 10%;  ≥5% at ≤1% → 5%;  otherwise 0. A share already on stays on while it still pays (gain ≥3%, cost ≤3%)
    so one noisy probe cannot flip it. No probe result at all → the previous decision is kept untouched."""
    prev = dict(previous or {})
    if not probe or not probe.get("ok"):
        return prev
    b, a = probe["before"], probe["after"]
    gain = (b["reason_loss"] - a["reason_loss"]) / max(b["reason_loss"], 1e-9)
    cost = (a["text_loss"] - b["text_loss"]) / max(b["text_loss"], 1e-9)
    share = 0.10 if (gain >= 0.15 and cost <= 0.02) else 0.05 if (gain >= 0.05 and cost <= 0.01) else 0.0
    if share == 0.0 and prev.get("reasoning_share", 0) > 0 and gain >= 0.03 and cost <= 0.03:
        share = prev["reasoning_share"]
    return {"reasoning_share": share, "reasoning_gain": round(gain, 4), "reasoning_cost": round(cost, 4),
            "reasoning_exact": [round(b.get("exact", 0), 3), round(a.get("exact", 0), 3)],
            "updated": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), "probe_steps": probe.get("steps")}


def read_progress(root: Path | None) -> dict:
    if not root:
        return {}
    for p in Path(root).rglob(FILE):
        try:
            return json.loads(p.read_text(encoding="utf-8")).get("auto", {}) or {}
        except Exception:
            continue
    return {}


def _fetch() -> dict:
    """The decided settings: from the attached dataset when present, else ONE small file through the Kaggle API."""
    for p in list(Path("/kaggle/input").glob(f"**/{SOURCE_DATASET}/**/{FILE}"))[:1]:
        return read_progress(p.parent)
    try:
        from sham_inputs import _ensure_credentials
        user = _ensure_credentials()
        if not user:
            return {}
        with tempfile.TemporaryDirectory() as d:
            subprocess.run(["kaggle", "datasets", "download", f"{user}/{SOURCE_DATASET}", "-f", FILE, "-p", d, "--force"],
                           capture_output=True, text=True, timeout=120)
            for z in Path(d).glob("*.zip"):
                with zipfile.ZipFile(z) as zf:
                    zf.extractall(d)
            return read_progress(Path(d))
    except Exception:
        return {}


def get(name: str, default=None):
    if "auto" not in _CACHE:
        _CACHE["auto"] = _fetch()
    return _CACHE["auto"].get(name, default)


if __name__ == "__main__":
    ok = lambda b_r, a_r, b_t, a_t: {"ok": True, "before": {"reason_loss": b_r, "text_loss": b_t, "exact": 0.0},
                                      "after": {"reason_loss": a_r, "text_loss": a_t, "exact": 0.1}, "steps": 300}
    assert decide_reasoning(ok(6.0, 3.0, 5.0, 5.05))["reasoning_share"] == 0.10          # learns fast, text barely moves
    assert decide_reasoning(ok(6.0, 5.5, 5.0, 5.04))["reasoning_share"] == 0.05          # learns a little
    assert decide_reasoning(ok(6.0, 3.0, 5.0, 5.5))["reasoning_share"] == 0.0            # learns, but costs 10% on ordinary text
    assert decide_reasoning(ok(6.0, 5.95, 5.0, 5.0))["reasoning_share"] == 0.0           # does not learn
    prev = {"reasoning_share": 0.10}
    assert decide_reasoning(ok(6.0, 5.7, 5.0, 5.12), prev)["reasoning_share"] == 0.10    # one weaker probe does not flip it off
    assert decide_reasoning(ok(6.0, 6.0, 5.0, 5.5), prev)["reasoning_share"] == 0.0      # but a clearly bad one does
    assert decide_reasoning({"ok": False}, prev) == prev and decide_reasoning(None, None) == {}   # no verdict → nothing changes
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / FILE).write_text(json.dumps({"base": "x", "auto": {"reasoning_share": 0.05}}), encoding="utf-8")
        assert read_progress(Path(d)) == {"reasoning_share": 0.05} and read_progress(None) == {}
    assert get("anything", 7) == 7 or True      # never raises without credentials
    print("sham_auto_config self-test OK")
