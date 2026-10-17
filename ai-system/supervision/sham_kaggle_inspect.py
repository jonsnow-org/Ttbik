"""
Sham Kaggle inspect (read-only, owner 2026-10-16): status + last log tail of each restarted notebook, and the
latest version (number, date, size) of every sham* dataset. Changes nothing on Kaggle.

  python sham_kaggle_inspect.py            (needs KAGGLE_USERNAME + KAGGLE_API_TOKEN/KAGGLE_KEY)
Notebook slugs come from SHAM_RESTART_KERNELS / SHAM_RESTART_TRACKS like the restarter; they are printed by alias.
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
TAIL = int(os.environ.get("SHAM_INSPECT_TAIL", "60"))
KEY = re.compile(r"step|publish|نشر|error|Error|Traceback|loss|خسارة|stage|crawl|small_training|multimodal|✓|⚠|❌", re.I)


def log_lines(text: str) -> list[str]:
    try:
        entries = json.loads(text)
    except Exception:
        return text.splitlines()
    out: list[str] = []
    buf = ""
    for e in entries if isinstance(entries, list) else []:
        buf += str(e.get("data", ""))
        *done, buf = buf.split("\n")
        out += [f"[{float(e.get('time', 0)) / 3600:5.2f}h] {l}" for l in done if l.strip()]
    if buf.strip():
        out.append(buf)
    return out


def slugs(api, work: Path) -> list[str]:
    s = [x.strip() for x in os.environ.get("SHAM_RESTART_KERNELS", "").split(",") if x.strip()]
    tracks = [x.strip() for x in os.environ.get("SHAM_RESTART_TRACKS", "").split(",") if x.strip()]
    if tracks:
        import sham_registry as reg
        kernels, _ = reg.discover(api, work, with_logs=False)
        reg.assign_roles(kernels)
        s += [k.ref for k in kernels if k.track in tracks and k.role == "primary" and k.ref not in s]
    return s


def main() -> int:
    from kaggle.api.kaggle_api_extended import KaggleApi
    api = KaggleApi(); api.authenticate()
    work = Path(tempfile.mkdtemp())
    for i, ref in enumerate(slugs(api, work), 1):
        print(f"\n===== دفتر {i} =====")
        try:
            st = api.kernels_status(ref)
            print("status:", getattr(st, "status", st), "|", getattr(st, "failure_message", "") or "")
        except Exception as exc:
            print("status: ?", type(exc).__name__)
        d = work / f"k{i}"; d.mkdir()
        try:
            api.kernels_output(ref, str(d), file_pattern=r".*\.log$", force=True, quiet=True)
        except Exception as exc:
            print("log: unavailable", type(exc).__name__); continue
        lines = [l for p in d.rglob("*.log") for l in log_lines(p.read_text(encoding="utf-8", errors="ignore"))]
        if not lines:
            print("log: empty (running sessions expose no log until they end)"); continue
        print(f"-- key lines (last 40 of {len(lines)}) --"); print("\n".join([l for l in lines if KEY.search(l)][-40:])[:12000])
        print(f"-- tail {TAIL} --"); print("\n".join(lines[-TAIL:])[:12000])
    print("\n===== مجموعات sham* =====")
    user = os.environ.get("KAGGLE_USERNAME") or "jonsnowjonsnow"
    seen = []
    for page in range(1, 6):
        try:
            batch = api.dataset_list(user=user, search="sham", page=page) or []
        except Exception as exc:
            print("dataset_list:", type(exc).__name__); break
        if not batch:
            break
        seen += [b for b in batch if str(getattr(b, "ref", "")).startswith(f"{user}/sham")]
    for b in sorted(seen, key=lambda b: str(getattr(b, "ref", ""))):
        ref = str(getattr(b, "ref", ""))
        vn = getattr(b, "current_version_number", None) or getattr(b, "currentVersionNumber", None) or "?"
        size = getattr(b, "total_bytes", None) or getattr(b, "totalBytes", None) or 0
        upd = getattr(b, "last_updated", None) or getattr(b, "lastUpdated", None)
        print(f"{ref.split('/')[-1]} | v{vn} | {str(upd)[:19]} UTC | {int(size or 0) / 1e9:.2f} GB")
    return 0


def _self_test() -> None:
    t = json.dumps([{"time": 3600, "data": "a\nstep 1"}, {"time": 7200, "data": "0\n"}])
    assert log_lines(t) == ["[ 1.00h] a", "[ 2.00h] step 10"], log_lines(t)
    print("sham_kaggle_inspect self-test OK")


if __name__ == "__main__":
    if not (os.environ.get("KAGGLE_API_TOKEN") or os.environ.get("KAGGLE_KEY")) or "--selftest" in sys.argv:
        _self_test(); sys.exit(0)
    sys.exit(main())
