#!/usr/bin/env python3
"""Appends new accepted records to the private Kaggle dataset <KAGGLE_USERNAME>/sham-teacher-records (the pool every Sham trainer reads).
Downloads the current version (if any), merges by prompt (no duplicates), keeps only records the generator accepted (verification_status passed | owner_accepted), uploads a new version.
    python publish_pool.py NEW.jsonl [--dry-run]
Needs the kaggle CLI + KAGGLE_USERNAME / KAGGLE_API_TOKEN in the environment. Prints counts only.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

OK = {"passed", "owner_accepted"}


def merge(old: list[dict], new: list[dict]) -> tuple[list[dict], int]:
    seen = {" ".join(r["prompt"].split()) for r in old}
    out, added = list(old), 0
    for r in new:
        if (r.get("metadata") or {}).get("verification_status") not in OK:
            continue
        k = " ".join(r["prompt"].split())
        if k in seen:
            continue
        seen.add(k)
        out.append(r)
        added += 1
    return out, added


def read(path: Path) -> list[dict]:
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines() if path.exists() else []:
        try:
            rows.append(json.loads(line))
        except ValueError:
            pass
    return rows


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    dry = "--dry-run" in argv
    new = read(Path(argv[0]))
    user = os.environ.get("KAGGLE_USERNAME", "")
    ref = f"{user}/sham-teacher-records"
    work = Path(tempfile.mkdtemp())
    old: list[dict] = []
    if not dry:
        r = subprocess.run(["kaggle", "datasets", "download", "-d", ref, "-p", str(work / "old"), "--unzip"], capture_output=True, text=True)
        for f in sorted((work / "old").rglob("*.jsonl")) if (work / "old").exists() else []:
            old += read(f)
        exists = r.returncode == 0
    merged, added = merge(old, new)
    print(json.dumps({"old": len(old), "new_accepted": added, "total": len(merged)}))
    if dry or not added:
        return 0
    out = work / "out"
    out.mkdir()
    (out / "records.jsonl").write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in merged), encoding="utf-8")
    (out / "dataset-metadata.json").write_text(json.dumps({"title": "sham-teacher-records", "id": ref, "licenses": [{"name": "other"}], "isPrivate": True}), encoding="utf-8")
    cmd = ["kaggle", "datasets", "version", "-p", str(out), "-m", "teacher pool update"] if exists else ["kaggle", "datasets", "create", "-p", str(out)]
    p = subprocess.run(cmd, capture_output=True, text=True)
    print("kaggle:", "ok" if p.returncode == 0 else "failed " + (p.stdout + p.stderr)[-300:].replace(os.environ.get("KAGGLE_API_TOKEN", "#"), "***"))
    return p.returncode


if __name__ == "__main__":
    sys.exit(main())
