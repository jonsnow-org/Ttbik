#!/usr/bin/env python3
"""Print the status and the end of the log of one Kaggle kernel (read-only).

Used by .github/workflows/sham-kernel-log.yml: SLUG (kernel slug under KAGGLE_USERNAME) and LINES (how many trailing lines) come from the environment.
Only the kernel's own text log is downloaded (its output folder can hold gigabytes of checkpoints). Token-looking strings are masked.
Offline self-test (no credentials): python sham_kernel_log.py --selftest
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

_SECRET = re.compile(r"(?i)(gh[pousr]_[A-Za-z0-9]{20,}|[A-Za-z0-9_\-]{32,}|(?:token|key|secret|password)\s*[=:]\s*\S+)")


def mask(text: str) -> str:
    return _SECRET.sub("[masked]", text)


def tail_of_log(raw: str, lines: int) -> str:
    """The last `lines` lines of a Kaggle .log file (a JSON array of {stream_name, time, data} records, or plain text)."""
    try:
        records = json.loads(raw)
        if isinstance(records, list):
            raw = "".join(str(r.get("data", "")) for r in records if isinstance(r, dict))
    except ValueError:
        pass
    return mask("\n".join(raw.splitlines()[-lines:]))


def _kaggle(args: list[str], timeout: int = 240) -> str:
    try:
        p = subprocess.run(["kaggle", *args], capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return f"timeout after {timeout}s: kaggle {' '.join(args[:2])}"
    return (p.stdout or "") + (p.stderr or "")


def main() -> int:
    slug = os.environ.get("SLUG", "").strip()
    lines = int(os.environ.get("LINES", "120") or 120)
    owner = os.environ.get("KAGGLE_USERNAME", "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9\-]{1,80}", slug):
        print("bad slug")
        return 1
    print(mask(_kaggle(["kernels", "status", f"{owner}/{slug}"]).strip()))
    with tempfile.TemporaryDirectory() as ld:
        print(mask(_kaggle(["kernels", "output", f"{owner}/{slug}", "-p", ld, "--file-pattern", r".*\.log$"]).strip()[-600:]))
        logs = sorted(Path(ld).rglob("*.log"))
        if not logs:
            print("no .log file (a running kernel exposes no log until it ends)")
            return 0
        for lf in logs[:1]:
            print(f"--- end of {lf.name} ({lines} lines) ---")
            print(tail_of_log(lf.read_text(encoding="utf-8", errors="replace"), lines))
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        sample = json.dumps([{"stream_name": "stdout", "time": 1.0, "data": "a\nb\nghp_" + "x" * 30 + "\nc\n"}])
        out = tail_of_log(sample, 2)
        assert "ghp_" not in out and out.endswith("c"), out
        assert tail_of_log("l1\nl2\nl3", 2) == "l2\nl3"
        print("sham_kernel_log self-test OK")
        sys.exit(0)
    sys.exit(main())
