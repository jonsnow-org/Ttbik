"""
How long does each Sham notebook on Kaggle really run? (read-only; owner, 2026-10-12: short notebooks scheduled beside long ones waste the free slots)

For every Sham notebook it downloads the last run's log and reads the last timestamp (seconds since the run began = the run's real length),
then prints one line per notebook: track, status, GPU or not, last run date, run length in hours, and what the orchestrator would do with it.
Public Actions logs: notebooks appear by track name and an alias number only — never their real names (owner's decision).

  python sham_kaggle_runs.py [workdir]
Offline self-test (no credentials): python sham_kaggle_runs.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import sham_registry as reg  # noqa: E402


def run_seconds(log_text: str) -> float:
    """Length of a run from a Kaggle .log (a JSON list of {"stream_name","time","data"}): the largest timestamp."""
    try:
        entries = json.loads(log_text)
    except Exception:
        return 0.0
    return max((float(e.get("time", 0.0)) for e in entries if isinstance(e, dict)), default=0.0)


def last_run_seconds(api, ref: str, workdir: Path) -> float:
    d = workdir / ("dur__" + ref.replace("/", "__"))
    d.mkdir(parents=True, exist_ok=True)
    try:
        api.kernels_output(ref, str(d), file_pattern=r".*\.log$", force=True, quiet=True)
    except Exception:
        return 0.0
    best = 0.0
    for p in d.rglob("*.log"):
        best = max(best, run_seconds(p.read_text(encoding="utf-8", errors="ignore")))
    return best


def main(workdir: Path) -> int:
    from kaggle.api.kaggle_api_extended import KaggleApi
    api = KaggleApi()
    api.authenticate()
    api = reg.RateLimitedApi(api)
    kernels, _ds = reg.discover(api, workdir, with_logs=False)
    reg.assign_roles(kernels)
    counts: dict[str, int] = {}
    rows = []
    for k in sorted(kernels, key=lambda k: (k.track or "zz", k.last_run), reverse=False):
        if not k.track or k.track in ("control_center",):
            continue
        counts[k.track] = counts.get(k.track, 0) + 1
        hours = last_run_seconds(api, k.ref, workdir) / 3600 if k.status in ("complete", "error", "running", "cancelAcknowledged") else 0.0
        rows.append((k.track, counts[k.track], k.role, k.status, "GPU" if k.gpu else "CPU", (k.last_run or "")[:10], hours))
    print("المسار | رقم | الدور | الحالة | العتاد | آخر تشغيل | مدة التشغيل (ساعة)")
    for r in rows:
        print(f"{r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} | {r[5]} | {r[6]:.2f}")
    return 0


def _self_test() -> None:
    log = json.dumps([{"stream_name": "stdout", "time": 1.5, "data": "a"}, {"stream_name": "stdout", "time": 7200.0, "data": "b"}])
    assert run_seconds(log) == 7200.0 and run_seconds("not json") == 0.0 and run_seconds("[]") == 0.0
    print("sham_kaggle_runs self-test OK")


if __name__ == "__main__":
    if not (os.environ.get("KAGGLE_API_TOKEN") or os.environ.get("KAGGLE_KEY")):
        _self_test()
        sys.exit(0)
    sys.exit(main(Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp())))
