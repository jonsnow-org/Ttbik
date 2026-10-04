"""
The GitHub-hosted collector ("الزاحف العام"): runs on the free GitHub Actions runner (CPU only, no training),
reads the sources in sham_sources_gh.py around the clock in 5.5-hour runs and publishes what it finds as the
text corpus `sham-crawl-gh-corpus` — a name starting with `sham-crawl-` and ending with `-corpus`, so every
notebook that reads collection corpora finds it automatically:
  • the chat stage (sham_merge.research_corpus_files → text rehearsal),
  • the stage-1 text pipeline (sham_text_stream: the "crawl corpora" source).

It is not tied to a language or a topic. Each run continues the previous one: the published dataset keeps
`crawl_urls.json` (every address already read — nothing is read twice, run after run) and the text shards
(the newest ones, capped at CAP_MB so the dataset stays a useful size).

    python sham_gh_collect.py --hours 5.3
"""

from __future__ import annotations

import argparse
import json
import os
import queue
import re
import shutil
import threading
import time
from pathlib import Path

NAME = "gh-collect"
CORPUS = "sham-crawl-gh-collect-corpus"
CAP_MB = 1500
MAX_SHARE = 0.2   # no single source may supply more than this share of the collected characters (diversity)
WORK = Path(os.environ.get("SHAM_WORK", "/tmp/sham_gh_collect"))


def squash(text: str) -> str:
    """One document: single newlines kept (code stays code), blank lines removed, so a blank line can mark the end of a document."""
    return re.sub(r"\n\s*\n+", "\n", text.replace("\r", "")).strip()


def balance(states, chars_by: dict, total: int, max_share: float = MAX_SHARE, pause: float = 20.0) -> list[str]:
    """Sources that already supplied more than max_share of everything collected rest for a while, so the fast, chatty
    ones (abstract APIs return 25 items a call) cannot crowd out books, code, discussions and the rest."""
    now, rested = time.time(), []
    for st in states:
        share = chars_by.get(st.name, 0) / max(total, 1)
        if share > max_share:
            st.rest_until = max(st.rest_until, now + pause)
            rested.append(st.name)
    return rested


def trim_to_cap(text_dir: Path, cap_mb: int) -> int:
    files = sorted(text_dir.glob("*.txt"), key=lambda p: p.stat().st_mtime)
    total = sum(p.stat().st_size for p in files)
    dropped = 0
    while files and total > cap_mb * 1024 * 1024:
        p = files.pop(0)
        total -= p.stat().st_size
        p.unlink()
        dropped += 1
    return dropped


def run(hours: float = 5.3, publish_every_hours: float = 1.5, workers: int = 14, dry_seconds: float | None = None,
        sources=None, publish=True) -> dict:
    import sham_spider
    from sham_inputs import fetch_dataset, publish_dataset
    from sham_sources_gh import gh_sources
    from sham_spider import Seen, Spider

    t0 = time.time()
    budget = dry_seconds if dry_seconds is not None else hours * 3600 - 8 * 60   # the last minutes: final publish
    out = WORK / "corpus"
    text_dir = out / "text"
    if WORK.exists():
        shutil.rmtree(WORK)
    text_dir.mkdir(parents=True)

    # continue the previous run: its text shards and the addresses it already read
    prev = fetch_dataset(CORPUS) if publish else None
    carried = 0
    if prev:
        for p in sorted(prev.rglob("text/**/*.txt")):
            shutil.copy2(p, text_dir / p.name)
            carried += 1
        urls = next(iter(prev.rglob("crawl_urls.json")), None)
        if urls:
            sham_spider.URL_SEEN = Seen.load(urls)
        print(f"استئناف الجمع: {carried} ملف نص سابق، {len(sham_spider.URL_SEEN):,} عنوان مقروء")
    seen = Seen()
    raw_q: queue.Queue = queue.Queue(maxsize=512)
    spider = Spider(sources if sources is not None else gh_sources(text_only=True), seen, raw_q, {"text": 1.0},
                    workers=workers, seed=int(t0) % 100000).start()

    shard_path = text_dir / f"gh_{int(t0)}.txt"
    shard = open(shard_path, "a", encoding="utf-8")
    stats = {"docs": 0, "chars": 0, "published": 0}
    by_source: dict[str, int] = {}
    chars_by: dict[str, int] = {}
    last_balance = time.time()
    last_pub, last_log = time.time(), time.time()

    def publish_now(final=False):
        shard.flush()
        dropped = trim_to_cap(text_dir, CAP_MB)
        sham_spider.URL_SEEN.save(out / "crawl_urls.json")
        (out / "collect_progress.json").write_text(json.dumps(
            {"by": "sham_gh_collect", "docs": stats["docs"], "sources": by_source, "updated": time.time()}), encoding="utf-8")
        if not publish:
            return None
        slug = publish_dataset(out, CORPUS, f"{stats['docs']:,} documents this run" + (" (final)" if final else ""))
        if slug:
            stats["published"] += 1
        if dropped:
            print(f"   (حُذفت {dropped} ملفات أقدم لإبقاء المجموعة تحت {CAP_MB} ميغابايت)")
        return slug

    try:
        while time.time() - t0 < budget:
            try:
                item = raw_q.get(timeout=5)
            except queue.Empty:
                continue
            doc = squash(item.text)
            if len(doc) < 200:
                continue
            shard.write(doc + "\n\n")
            stats["docs"] += 1
            stats["chars"] += len(doc)
            key = "github" if item.source.startswith("github") else "stackexchange" if item.source.startswith("se_") else item.source
            by_source[key] = by_source.get(key, 0) + 1
            chars_by[key] = chars_by.get(key, 0) + len(doc)
            if time.time() - last_balance > 5 and stats["chars"] > 2_000_000:
                balance(spider.sources, chars_by, stats["chars"])
                last_balance = time.time()
            if time.time() - last_log > 300:
                print(f"[{(time.time() - t0) / 3600:.2f} س] {stats['docs']:,} وثيقة | {stats['chars'] / 1e6:.1f} م حرف | "
                      + " ".join(f"{k}:{v}" for k, v in sorted(by_source.items(), key=lambda kv: -kv[1])[:8]))
                print(spider.report())
                last_log = time.time()
            if time.time() - last_pub > publish_every_hours * 3600:
                publish_now()
                last_pub = time.time()
    finally:
        spider.stop()
    final = publish_now(final=True)
    shard.close()
    report = (f"🕸 الزاحف العام (GitHub): {stats['docs']:,} وثيقة، {stats['chars'] / 1e6:.1f} مليون حرف في "
              f"{(time.time() - t0) / 3600:.1f} ساعة | " + " ".join(f"{k}:{v}" for k, v in sorted(by_source.items(), key=lambda kv: -kv[1]))
              + (f" | نُشر إلى {final}" if final else " | لم يُنشر"))
    print(report)
    return {"stats": stats, "by_source": by_source, "published": final, "report": report}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, default=5.3)
    ap.add_argument("--publish-every", type=float, default=1.5)
    a = ap.parse_args()
    res = run(a.hours, a.publish_every)
    try:
        from telegram_report import send_telegram_message
        send_telegram_message(os.environ.get("TELEGRAM_BOT_TOKEN"), os.environ.get("TELEGRAM_CHAT_ID"), res["report"][:4000])
    except Exception as exc:
        print(f"telegram: {exc}")


if __name__ == "__main__":
    main()
