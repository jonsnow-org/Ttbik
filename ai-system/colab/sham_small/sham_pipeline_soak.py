"""
A real-source soak test of the endless text pipeline (sham_text_stream), run on the GitHub CPU runner after the merge job.

Why: the pipeline feeds stage-1 on the GPU, and a CPU session uses a fixed slice until the pipeline's safeguards (reader child
process, memory guard, fallback) are proven on a real machine. A GitHub runner has 7 GB, i.e. harder than Kaggle, so a clean
soak here is real evidence. It pulls windows for `seconds`, and reports windows/s, peak resident memory (parent + children),
restarts, memory pauses and fallback use. It never raises: the result is printed (and returned) for the job log.

    python sham_pipeline_soak.py [seconds]
"""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent


def _rss_tree_gb() -> float:
    """Resident memory of this process plus its children (the reader child holds the HF streams)."""
    total = 0
    me = os.getpid()
    try:
        for pid in os.listdir("/proc"):
            if not pid.isdigit():
                continue
            try:
                with open(f"/proc/{pid}/status") as f:
                    txt = f.read()
                ppid = int(next(l for l in txt.splitlines() if l.startswith("PPid:")).split()[1])
                if int(pid) != me and ppid != me:
                    continue
                rss = next((l for l in txt.splitlines() if l.startswith("VmRSS:")), None)
                total += int(rss.split()[1]) if rss else 0
            except Exception:
                continue
    except Exception:
        pass
    return total / 1e6


def soak(seconds: float = 300.0, seq_len: int = 512) -> dict:
    os.environ["SHAM_PIPELINE"] = "1"
    out = {"ok": False}
    try:
        sys.path.insert(0, str(HERE))
        from text_tokenizer import ShamTextTokenizer
        import sham_text_stream

        tok = ShamTextTokenizer.load(str(HERE / "sham_general_tokenizer.json"))
        t0 = time.time()
        s = sham_text_stream.stream_for(tok, seq_len, [])
        n, peak = 0, 0.0
        while time.time() - t0 < seconds:
            s.next_window()
            n += 1
            if n % 20 == 0:
                peak = max(peak, _rss_tree_gb())
        peak = max(peak, _rss_tree_gb())
        dt = time.time() - t0
        st = dict(s.stats)
        s.close()
        out.update(ok=True, windows=n, seconds=round(dt), per_second=round(n / dt, 2), peak_gb=round(peak, 2), stats=st)
    except Exception as exc:   # a soak that cannot run is itself a finding, never a crash of the job
        out["error"] = f"{type(exc).__name__}: {str(exc)[:200]}"
    total = 0.0
    try:
        total = next(int(l.split()[1]) for l in open("/proc/meminfo") if l.startswith("MemTotal:")) / 1e6
    except Exception:
        pass
    out["machine_gb"] = round(total, 1)
    heavy = bool(total) and out.get("peak_gb", 0) > 0.8 * total     # within 20% of the machine's memory = not safe to leave unattended
    verdict = "✅ سليم" if out.get("ok") and out.get("stats", {}).get("fallback", 0) == 0 and not heavy else "⚠ يحتاج نظرة"
    print(f"🌊 اختبار تحمّل خط النص ({verdict}): {out}")
    return out


if __name__ == "__main__":
    soak(float(sys.argv[1]) if len(sys.argv) > 1 else 60.0)
