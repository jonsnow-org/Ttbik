"""
Sham's report mirror ("مرآة التقارير").

Every session of every notebook sends its report to the owner's Telegram — and nowhere else, so anyone supervising
the project later (another assistant, the owner on a different day) had to scroll a chat. send_telegram_message now
also hands each report to log_report(): the last REPORTS_KEPT reports are kept, newest last, in the small
dataset `sham-reports` (reports.jsonl), which the status job (ai-system/supervision/sham_status.py) reads and
publishes next to the live state.

Best effort and silent: no credentials, no network or a failed publish never affects the session that sent the
report. Concurrent sessions can overwrite each other's entry in the worst case (the dataset is versioned); a report
lost that way is still in Telegram.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

NAME = "sham-reports"
REPORTS_KEPT = 80
MAX_CHARS = 3800


def merge(existing: list[dict], entry: dict, keep: int = REPORTS_KEPT) -> list[dict]:
    rows = [r for r in existing if not (r.get("text") == entry["text"] and r.get("source") == entry["source"])]
    return (rows + [entry])[-keep:]


def log_report(text: str, source: str | None = None, fetch=None, publish=None) -> bool:
    if not text or not (os.environ.get("KAGGLE_USERNAME") or os.environ.get("SHAM_REPORTS_FORCE")):
        return False
    try:
        if fetch is None or publish is None:
            from sham_inputs import fetch_dataset, publish_dataset
            fetch, publish = fetch or (lambda n: fetch_dataset(n, fresh=True)), publish or publish_dataset
        first = next((l.strip() for l in text.splitlines() if l.strip()), "")[:90]
        entry = {"time": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), "source": source or os.environ.get("SHAM_SOURCE") or first,
                 "text": text[:MAX_CHARS]}
        root = fetch(NAME)
        rows: list[dict] = []
        if root:
            for p in Path(root).rglob("reports.jsonl"):
                rows = [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]
                break
        rows = merge(rows, entry)
        out = Path(os.environ.get("TMPDIR", "/tmp")) / "sham_reports_upload"
        out.mkdir(parents=True, exist_ok=True)
        (out / "reports.jsonl").write_text("\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n", encoding="utf-8")
        return bool(publish(out, NAME, f"{len(rows)} reports, last: {entry['source'][:50]}"))
    except Exception as exc:
        print(f"sham_reports: {exc.__class__.__name__}: {str(exc)[:100]} — (التقرير وصل تيليجرام على أي حال)")
        return False


if __name__ == "__main__":
    import tempfile

    assert merge([], {"source": "a", "text": "x"}) == [{"source": "a", "text": "x"}]
    rows = [{"source": "a", "text": str(i)} for i in range(100)]
    assert len(merge(rows, {"source": "b", "text": "new"})) == REPORTS_KEPT and merge(rows, {"source": "b", "text": "new"})[-1]["text"] == "new"
    assert len(merge([{"source": "a", "text": "same"}], {"source": "a", "text": "same"})) == 1   # no duplicates
    assert log_report("x") is False or os.environ.get("KAGGLE_USERNAME")   # silent without credentials
    td = Path(tempfile.mkdtemp())
    store = {}
    def fetch(n):
        d = td / "fetched"
        return d if (d / "reports.jsonl").exists() else None
    def publish(up, name, msg):
        d = td / "fetched"; d.mkdir(exist_ok=True)
        (d / "reports.jsonl").write_text((Path(up) / "reports.jsonl").read_text(encoding="utf-8"), encoding="utf-8")
        return name
    os.environ["SHAM_REPORTS_FORCE"] = "1"
    assert log_report("🧠 تقرير جلسة شام\nالخسارة 3.2", fetch=fetch, publish=publish)
    assert log_report("🧩 دمج\nنجح", source="دمج", fetch=fetch, publish=publish)
    got = [json.loads(l) for l in (td / "fetched/reports.jsonl").read_text(encoding="utf-8").splitlines()]
    assert [g["source"] for g in got] == ["🧠 تقرير جلسة شام", "دمج"], got
    assert log_report("x", fetch=lambda n: (_ for _ in ()).throw(RuntimeError("boom")), publish=publish) is False
    print("sham_reports self-test OK")
