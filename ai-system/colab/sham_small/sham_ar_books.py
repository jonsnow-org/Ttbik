"""Clean Arabic book text for Sham's training (owner 2026-11-12: Wikipedia and news do not reach the goal; the Arabic needs better content).

Source: Bayanat-Labs/open-arabic-books on Hugging Face = 1,545 Arabic books published by the Hindawi Foundation (modern standard Arabic: literature, science, history, philosophy, many translations),
rebuilt from Andreas Hallberg's Arabic E-Book Corpus, CC BY 4.0. Human-written, edited text; not machine-generated and not produced by any commercial model.
CC BY 4.0 needs attribution: every book used is listed with its title, authors and the book's own licence wording in ATTRIBUTION.json next to the text.

What this does (CPU only): read the `books` parquet files, skip near-duplicate books, cut each book into training documents on paragraph boundaries (about 1,500-6,000 characters, the size
the text stream draws), keep only documents the curation module accepts as Arabic prose, and write them as text/*.txt (documents separated by a blank line). `--publish` uploads the folder as
the Kaggle dataset `sham-curated-ar-books` (its name has no `sham-crawl-` prefix on purpose: it is a curated source with its own weight, not part of the raw crawl pile).

sham-ci: entrypoint (needs arguments; the tests are in test_sham_ar_books.py).
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

DOC_MIN, DOC_MAX = 1500, 6000
REPO = "Bayanat-Labs/open-arabic-books"
PARQUET_REF = "refs/convert/parquet"


def paragraphs(text: str) -> list[str]:
    parts = re.split(r"\n\s*\n|\r\n\s*\r\n", text.replace("‏", "").replace("﻿", ""))
    return [re.sub(r"[ \t ]+", " ", p).strip() for p in parts if p and p.strip()]


def split_docs(text: str, lo: int = DOC_MIN, hi: int = DOC_MAX) -> list[str]:
    """Paragraphs are packed into documents of lo..hi characters; one very long paragraph is cut at a sentence end."""
    docs: list[str] = []
    cur: list[str] = []
    size = 0

    def flush() -> None:
        nonlocal cur, size
        if cur and size >= lo:
            docs.append("\n".join(cur))
        cur, size = [], 0

    for para in paragraphs(text):
        while len(para) > hi:
            cut = max(para.rfind(m, 0, hi) for m in ("۔", ".", "؟", "!", "؛")) if any(m in para[:hi] for m in ("۔", ".", "؟", "!", "؛")) else hi - 1
            cut = cut if cut > hi // 3 else hi - 1
            piece, para = para[: cut + 1].strip(), para[cut + 1:].strip()
            if size + len(piece) > hi:
                flush()
            cur.append(piece)
            size += len(piece) + 1
            flush()
        if not para:
            continue
        if size + len(para) > hi:
            flush()
        cur.append(para)
        size += len(para) + 1
        if size >= (lo + hi) // 2:
            flush()
    flush()
    return docs


def build(rows, out: Path, accept) -> dict:
    """rows: iterable of dicts with book_id, title, authors, license_quote, text_raw, near_duplicate_group, is_translation."""
    (out / "text").mkdir(parents=True, exist_ok=True)
    seen_groups: set[str] = set()
    attribution: list[dict] = []
    stats = {"books": 0, "skipped_duplicates": 0, "docs": 0, "chars": 0, "rejected_docs": 0, "translations": 0}
    shard_idx, shard_chars, fh = 0, 0, None
    for row in rows:
        group = str(row.get("near_duplicate_group") or "")
        if group and group in seen_groups:
            stats["skipped_duplicates"] += 1
            continue
        if group:
            seen_groups.add(group)
        kept = 0
        for doc in split_docs(str(row.get("text_raw") or "")):
            if not accept(doc):
                stats["rejected_docs"] += 1
                continue
            if fh is None or shard_chars >= 50_000_000:
                if fh:
                    fh.close()
                fh = (out / "text" / f"books{shard_idx:04d}.txt").open("w", encoding="utf-8")
                shard_idx, shard_chars = shard_idx + 1, 0
            fh.write(doc + "\n\n")
            shard_chars += len(doc) + 2
            stats["docs"] += 1
            stats["chars"] += len(doc)
            kept += 1
        if kept:
            stats["books"] += 1
            stats["translations"] += 1 if row.get("is_translation") else 0
            attribution.append({"book_id": row.get("book_id"), "title": row.get("title"), "authors": row.get("authors"), "licence": row.get("license_quote"),
                                "source": "Hindawi Foundation via Andreas Hallberg's Arabic E-Book Corpus v1 (CC BY 4.0), rebuilt by Bayanat-Labs/open-arabic-books"})
    if fh:
        fh.close()
    (out / "ATTRIBUTION.json").write_text(json.dumps(attribution, ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "STATS.json").write_text(json.dumps(stats, ensure_ascii=False, indent=1), encoding="utf-8")
    return stats


def read_books(limit: int = 0):
    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download, list_repo_files
    files = sorted(f for f in list_repo_files(REPO, repo_type="dataset", revision=PARQUET_REF) if f.startswith("books/train/") and f.endswith(".parquet"))
    n = 0
    cols = ["book_id", "title", "authors", "is_translation", "license_quote", "text_raw", "near_duplicate_group"]
    for f in files:
        pf = pq.ParquetFile(hf_hub_download(REPO, f, repo_type="dataset", revision=PARQUET_REF))
        for batch in pf.iter_batches(batch_size=8, columns=cols):
            for row in batch.to_pylist():
                yield row
                n += 1
                if limit and n >= limit:
                    return


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--publish", action="store_true")
    a = ap.parse_args()
    import sham_curate
    out = Path(a.out)
    stats = build(read_books(a.limit), out, lambda d: sham_curate.classify(d)["bucket"] == "ar_prose")
    print("books", stats["books"], "| docs", f"{stats['docs']:,}", "| chars", f"{stats['chars'] / 1e6:.1f}M", "| duplicate books skipped", stats["skipped_duplicates"],
          "| rejected docs", stats["rejected_docs"], "| translations", stats["translations"])
    if a.publish and stats["docs"]:
        from sham_inputs import publish_dataset
        slug = publish_dataset(out, "sham-curated-ar-books", f"{stats['books']} Hindawi books, {stats['docs']:,} documents (CC BY 4.0, attribution inside)")
        print("published:", slug)


if __name__ == "__main__":
    main()
