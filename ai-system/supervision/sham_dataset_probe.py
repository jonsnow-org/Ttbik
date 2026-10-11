"""
Read-only probe of Kaggle datasets: their status, version and file list, and whether a download really works (first bytes only).
Why: `kaggle datasets download` answers a bare 404 for a dataset whose latest version is broken or still processing, and the callers print
nothing more (the access check said 'unavailable' for sham-merged-checkpoint for hours). This prints the facts.

  python sham_dataset_probe.py name1 name2 ...      (names without the owner; the owner is KAGGLE_USERNAME)
"""
from __future__ import annotations

import os
import subprocess
import sys


def run(cmd: list[str], timeout: int = 120) -> str:
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return ((r.stdout or "") + (r.stderr or "")).strip()


def main(names: list[str]) -> int:
    user = os.environ.get("KAGGLE_USERNAME", "")
    for n in names:
        slug = n if "/" in n else f"{user}/{n}"
        print(f"===== {slug}")
        print("status:", run(["kaggle", "datasets", "status", slug])[:300])
        files = run(["kaggle", "datasets", "files", slug, "--csv"])
        print("files:\n" + "\n".join(files.splitlines()[:12])[:900])
        meta = run(["kaggle", "datasets", "metadata", slug, "-p", "/tmp/dsmeta"])
        print("metadata:", meta[:200])
        tmp = f"/tmp/dsprobe_{n}"
        out = run(["kaggle", "datasets", "download", slug, "-p", tmp, "--unzip", "-f", "sham_small_tokenizer.json"], timeout=300)
        print("download one small file:", out[:300])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
