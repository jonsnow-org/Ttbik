"""Sham v2's focused notebooks, one after another (owner 2026-11-09: push them all and finish).

Kaggle runs at most 5 CPU sessions at once and Sham v1's notebooks use most of them, so the four v2 stage notebooks cannot all start together. This script is run every
30 minutes by .github/workflows/sham-v2-stage-queue.yml and starts the NEXT stage that has not run yet, only when no v2 stage notebook is running or waiting, and only when Kaggle accepts the push
(a refused push is simply tried again next time). A stage counts as done once its kernel has finished COMPLETE. Nothing is ever stopped or deleted, and Sham v1's notebooks are never touched.

    python3 sham_v2_stage_queue.py            # decide and (when it is time) push, using the kaggle CLI
    python3 sham_v2_stage_queue.py --plan     # only print what it would do
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
K = ROOT / "ai-system" / "colab" / "sham_small" / "kaggle_notebooks"
OWNER = "jonsnowjonsnow"
# order matters: the tools first (v2's biggest gap), then the media, then the two on the candidate donor
STAGES = [
    ("tools", K / "sham_v2_tools", "sham_v2_tools_train.ipynb", "sham-v2-tools-train"),
    ("media", K / "sham_v2_media", "sham_v2_media_train.ipynb", "sham-v2-media-train"),
    ("candidate-tools", K / "sham_v2_candidate_tools", "sham_v2_candidate_tools_train.ipynb", "sham-v2-candidate-tools-train"),
    ("candidate", K / "sham_v2_candidate", "sham_v2_candidate_train.ipynb", "sham-v2-candidate-train"),
]


def parse_status(text: str) -> str:
    """'running' | 'queued' | 'complete' | 'error' | 'cancelled' | 'missing' | 'unknown' from the kaggle CLI's words."""
    t = (text or "").lower()
    if "404" in t or "not found" in t or "was not found" in t or "no such" in t or "cannot access kernel" in t:      # Kaggle words a kernel that was never pushed as "Cannot access kernel ... (Permission 'kernels.get' was denied)"
        return "missing"
    m = re.search(r"kernelworkerstatus\.(\w+)", t)
    word = m.group(1) if m else ""
    return {"running": "running", "queued": "queued", "complete": "complete", "error": "error", "cancel_requested": "cancelled", "cancel_acknowledged": "cancelled"}.get(word, "unknown")


def decide(statuses: dict[str, str]) -> str | None:
    """The stage to push now, or None. Nothing starts while any stage is running / queued / unreadable; a stage that was never pushed is started, in order; complete / error / cancelled stages are skipped (an errored one is reported with the tail of its log, never retried blindly). If every stage is complete the queue is finished."""
    if any(s in ("running", "queued", "unknown") for s in statuses.values()):
        return None
    for name, *_ in STAGES:
        if statuses.get(name, "missing") == "missing":          # a stage that ended in error / cancelled is NOT started again by the queue (it would loop on a real bug): it is reported, and the queue moves on
            return name
    return None


def _kaggle(args: list[str]) -> str:
    p = subprocess.run(["kaggle", *args], capture_output=True, text=True, timeout=180)
    return (p.stdout or "") + (p.stderr or "")


def main(plan_only: bool = False) -> int:
    raw = {name: _kaggle(["kernels", "status", f"{OWNER}/{slug}"]) for name, _d, _f, slug in STAGES}
    statuses = {name: parse_status(text) for name, text in raw.items()}
    for name, text in raw.items():
        if statuses[name] == "unknown":
            print(f"  (unread status of {name}: {text.strip()[:240]!r})")
    print("status:", json.dumps(statuses, ensure_ascii=False))
    for name, st in statuses.items():
        if st == "error":                                   # what went wrong: the last lines of the kernel's own log
            slug = next(x[3] for x in STAGES if x[0] == name)
            with tempfile.TemporaryDirectory() as ld:
                _kaggle(["kernels", "output", f"{OWNER}/{slug}", "-p", ld])
                for lf in sorted(Path(ld).glob("*.log"))[:1]:
                    tail = lf.read_text(encoding="utf-8", errors="replace")[-2500:]
                    print(f"--- {name} ended in ERROR; the end of its log:\n{tail}\n---")
    todo = decide(statuses)
    if todo is None:
        print("nothing to start (a stage is running / waiting, or every stage is complete)")
        return 0
    print(f"next stage: {todo}")
    if plan_only:
        return 0
    name, d, f, slug = next(s for s in STAGES if s[0] == todo)
    with tempfile.TemporaryDirectory() as td:
        meta = json.loads((d / "kernel-metadata.json").read_text(encoding="utf-8"))
        (Path(td) / f).write_bytes((d / f).read_bytes())
        for gpu in (True, False):                          # GPU first; Kaggle's weekly GPU quota may be out, then the same notebook on CPU
            meta["enable_gpu"] = gpu
            (Path(td) / "kernel-metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
            out = _kaggle(["kernels", "push", "-p", td])
            print(out.strip())
            if "successfully pushed" in out.lower():
                print(f"started {name} ({'GPU' if gpu else 'CPU'})")
                return 0
            if gpu and "gpu quota" in out.lower():
                continue
            break
    print(f"Kaggle did not accept {name} now (for example the 5-session limit); the next run tries again")
    return 0


def _selftest() -> None:
    assert parse_status('x has status "KernelWorkerStatus.RUNNING"') == "running"
    assert parse_status('x has status "KernelWorkerStatus.COMPLETE"') == "complete"
    assert parse_status("404 Client Error: Not Found for url") == "missing"
    assert parse_status("Cannot access kernel 'jonsnowjonsnow/x' (Permission 'kernels.get' was denied). The most likely cause is a wrong kernel slug.") == "missing"
    assert parse_status("weird") == "unknown"
    names = [s[0] for s in STAGES]
    assert decide({n: "missing" for n in names}) == "tools"
    assert decide({"tools": "complete", "media": "missing", "candidate-tools": "missing", "candidate": "missing"}) == "media"
    assert decide({"tools": "running", "media": "missing", "candidate-tools": "missing", "candidate": "missing"}) is None
    assert decide({"tools": "complete", "media": "error", "candidate-tools": "missing", "candidate": "missing"}) == "candidate-tools"
    assert decide({"tools": "error", "media": "missing", "candidate-tools": "missing", "candidate": "missing"}) == "media"
    assert decide({n: "complete" for n in names}) is None
    assert decide({"tools": "complete", "media": "complete", "candidate-tools": "unknown", "candidate": "missing"}) is None
    for _n, d, f, _s in STAGES:
        assert (d / f).exists() and (d / "kernel-metadata.json").exists(), f"missing {d / f}"
    print("sham_v2_stage_queue self-test OK")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        _selftest()
    else:
        raise SystemExit(main("--plan" in sys.argv))
