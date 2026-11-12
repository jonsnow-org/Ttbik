"""Sham data curation: raw crawler text -> clean, precisely split buckets (owner 2026-11-12: train on clean, exactly separated data).

The collectors publish one mixed pile (sham-crawl-*-corpus: documents separated by a blank line). Training used to read that pile as it is. This module sorts it:

  * `classify(doc)` gives every document a language (ar / latin / mixed / other), a kind (prose / code / short) and, when it is not fit to train on, a reject reason
    (too short, mostly symbols or digits, link lists, repeated lines, long runs of one character, not text);
  * exact duplicates are dropped (normalised hash); a fixed 1% of the survivors goes to `heldout` (chosen by hash, so it never moves and is NEVER trained on: it measures);
  * the rest goes to buckets `ar_prose`, `latin_prose`, `mixed_prose`, `code`, written as shards; a JSON report says how many documents / characters each bucket and
    each reject reason holds, so the mix can be chosen with numbers.

Pure Python, CPU only, no network: `python sham_curate.py --in DIR --out DIR --report FILE`. Nothing here publishes or changes a training notebook.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path

MIN_CHARS = 200
HELDOUT_PERCENT = 1
_AR = re.compile(r"[\u0600-\u06FF\u0750-\u077F]")
_LAT = re.compile(r"[A-Za-z]")
_URL = re.compile(r"https?://\S+")
_CODE_LINE = re.compile(r"^\s*(def |class |import |from \S+ import |function |const |let |var |#include|public |private |return\b|if\s*\(|for\s*\(|while\s*\(|elif |else:|try:|\}|\{)|[;{}]\s*$|:\s*$")


def _norm(doc: str) -> str:
    return re.sub(r"\s+", " ", doc.lower()).strip()


def classify(doc: str) -> dict:
    """{"bucket": "ar_prose"|..., "lang": ..., "kind": ..., "reject": reason or ""}."""
    text = doc.strip()
    n = len(text)
    if n < MIN_CHARS:
        return {"bucket": "", "lang": "", "kind": "short", "reject": "too_short"}
    ar = len(_AR.findall(text))
    lat = len(_LAT.findall(text))
    letters = ar + lat
    digits = sum(c.isdigit() for c in text)
    spaces = sum(c.isspace() for c in text)
    symbols = n - letters - digits - spaces - sum(1 for c in text if c.isalpha())
    lang = "other"
    if letters >= n * 0.3:
        share = ar / max(1, letters)
        lang = "ar" if share >= 0.6 else "latin" if share <= 0.05 else "mixed"
    rows = [x for x in text.split("\n") if x.strip()]
    hits = sum(1 for x in rows if _CODE_LINE.search(x))
    code = hits >= 5 and hits >= len(rows) * 0.4 and lang != "ar"
    kind = "code" if code else "prose"
    if digits / n > 0.3:
        return {"bucket": "", "lang": lang, "kind": kind, "reject": "mostly_digits"}
    if letters < n * 0.3 and not code:
        return {"bucket": "", "lang": lang, "kind": kind, "reject": "not_text"}
    if symbols / n > 0.3 and not code:
        return {"bucket": "", "lang": lang, "kind": kind, "reject": "mostly_symbols"}
    if len(_URL.findall(text)) * 60 > n:
        return {"bucket": "", "lang": lang, "kind": kind, "reject": "link_list"}
    lines = [x.strip() for x in text.split("\n") if x.strip()]
    if len(lines) >= 5 and len(set(lines)) < len(lines) * 0.5:
        return {"bucket": "", "lang": lang, "kind": kind, "reject": "repeated_lines"}
    if re.search(r"(.)\1{19,}", text):
        return {"bucket": "", "lang": lang, "kind": kind, "reject": "char_run"}
    if lang == "other":
        return {"bucket": "", "lang": lang, "kind": kind, "reject": "other_language"}
    return {"bucket": "code" if code else f"{lang}_prose", "lang": lang, "kind": kind, "reject": ""}


def is_heldout(doc: str) -> bool:
    return int(hashlib.sha1(_norm(doc).encode("utf-8")).hexdigest()[:8], 16) % 100 < HELDOUT_PERCENT


def read_docs(folder: Path):
    for f in sorted(folder.rglob("*.txt")):
        buf: list[str] = []
        with f.open("r", encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                if line.strip():
                    buf.append(line.rstrip("\n"))
                elif buf:
                    yield "\n".join(buf)
                    buf = []
        if buf:
            yield "\n".join(buf)


def curate(src: Path, out: Path, shard_mb: int = 50, limit: int = 0) -> dict:
    out.mkdir(parents=True, exist_ok=True)
    seen: set[str] = set()
    stats = {"docs": 0, "chars": 0, "duplicates": 0, "buckets": {}, "rejects": {}, "examples": {}}
    handles: dict[str, tuple] = {}

    def write(bucket: str, doc: str) -> None:
        h = handles.get(bucket)
        if h is None or h[2] >= shard_mb * 1_000_000:
            if h:
                h[1].close()
            idx = (h[3] + 1) if h else 0
            d = out / bucket / "text"
            d.mkdir(parents=True, exist_ok=True)
            h = (d / f"part{idx:04d}.txt", (d / f"part{idx:04d}.txt").open("w", encoding="utf-8"), 0, idx)
        h[1].write(doc + "\n\n")
        handles[bucket] = (h[0], h[1], h[2] + len(doc) + 2, h[3])

    for doc in read_docs(src):
        stats["docs"] += 1
        stats["chars"] += len(doc)
        if limit and stats["docs"] > limit:
            break
        key = hashlib.sha1(_norm(doc).encode("utf-8")).hexdigest()
        if key in seen:
            stats["duplicates"] += 1
            continue
        seen.add(key)
        c = classify(doc)
        if c["reject"]:
            stats["rejects"][c["reject"]] = stats["rejects"].get(c["reject"], 0) + 1
            stats["examples"].setdefault(c["reject"], doc[:120].replace("\n", " "))
            continue
        bucket = "heldout" if is_heldout(doc) else c["bucket"]
        b = stats["buckets"].setdefault(bucket, {"docs": 0, "chars": 0})
        b["docs"] += 1
        b["chars"] += len(doc)
        write(bucket, doc)
    for h in handles.values():
        h[1].close()
    kept = sum(b["docs"] for b in stats["buckets"].values())
    stats["kept_docs"] = kept
    stats["kept_share"] = round(kept / max(1, stats["docs"]), 3)
    return stats


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="src", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    s = curate(Path(a.src), Path(a.out), limit=a.limit)
    Path(a.report).write_text(json.dumps(s, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"docs {s['docs']:,} | kept {s['kept_docs']:,} ({s['kept_share']:.0%}) | duplicates {s['duplicates']:,}")
    for k, v in sorted(s["buckets"].items(), key=lambda kv: -kv[1]["chars"]):
        print(f"  bucket {k}: {v['docs']:,} docs, {v['chars'] / 1e6:.1f}M chars")
    for k, v in sorted(s["rejects"].items(), key=lambda kv: -kv[1]):
        print(f"  reject {k}: {v:,} | e.g. {s['examples'].get(k, '')}")


if __name__ == "__main__":
    main()
