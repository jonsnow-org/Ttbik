"""
Sham media factory — runs INSIDE the owner's free Lightning Studio (4 CPU, 15 GB, 360 GB disk, internet), started and kept alive by GitHub.

Why: the tokenizer notebooks on Kaggle collected ~90 images per run (1,922 images in two months) because collecting is slow and they only own a
short session. Collecting is CPU + network work, which is exactly what this Studio has all day. So the Studio collects, de-duplicates and
packs the training data in big batches and publishes each batch as a private Kaggle dataset `sham-media-<kind>-<timestamp>`; the Kaggle GPU
notebooks then spend their whole session TRAINING on batches they have not consumed yet (sham_media_shards.py), never collecting.

Same collector the notebooks used (sham_data_sources.collect: verified open datasets, exact + perceptual de-duplication, per-source resume
cursors); the ledger lives on this Studio's disk, so a restart resumes where it stopped and a batch is never collected twice.

    python media_factory.py            # runs until SHAM_FACTORY_HOURS is over (default 3.3: the free Studio restarts every 4 h)
    python media_factory.py --measure  # one small cycle per kind, prints the real throughput, publishes nothing
Secrets (KAGGLE_*, HF_TOKEN) come from the Studio's private ~/.sham_env, loaded by the launcher. Nothing is printed.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "colab" / "sham_small"))

WORK = Path(os.environ.get("SHAM_FACTORY_DIR", str(Path.home() / "sham_factory")))
KINDS = [k for k in os.environ.get("SHAM_FACTORY_KINDS", "image,audio").split(",") if k]
HOURS = float(os.environ.get("SHAM_FACTORY_HOURS", "3.3"))
IMAGE_SIZE = int(os.environ.get("SHAM_IMAGE_SIZE", "256"))
BATCH = {"image": int(os.environ.get("SHAM_BATCH_IMAGE", "10000")), "audio": int(os.environ.get("SHAM_BATCH_AUDIO", "4000")),
         "video": int(os.environ.get("SHAM_BATCH_VIDEO", "80"))}


def cycle(kind: str, size: int, publish: bool) -> dict:
    from sham_data_sources import Ledger, collect
    from sham_inputs import publish_dataset

    ledgers = WORK / "ledgers"
    ledgers.mkdir(parents=True, exist_ok=True)
    ledger = Ledger.load(kind, search_root=ledgers, name=f"factory_{kind}")
    stamp = time.strftime("%Y%m%d%H%M", time.gmtime())
    out = WORK / f"batch_{kind}_{stamp}"
    t0 = time.time()
    manifest, stats = collect(kind, out, size, ledger, image_size=IMAGE_SIZE if kind == "image" else 64)
    secs = time.time() - t0
    ledger.save(ledgers)                                   # cursors + fingerprints survive a restart
    res = {"kind": kind, "written": stats.written, "seconds": round(secs), "per_hour": round(stats.written * 3600 / max(secs, 1)),
           "dups": stats.duplicates, "exhausted": stats.all_exhausted, "sources": stats.per_source, "published": None}
    print("🏭 " + json.dumps(res, ensure_ascii=False), flush=True)
    if stats.written and publish:
        slug = publish_dataset(out, f"sham-media-{kind}-{stamp}", f"{stats.written} new {kind} samples ({stats.summary()[:120]})")
        res["published"] = slug
    if not publish or res["published"]:
        import shutil
        shutil.rmtree(out, ignore_errors=True)             # the 360 GB disk is large, but nothing here is needed after publishing
    return res


def main() -> int:
    WORK.mkdir(parents=True, exist_ok=True)
    if "--measure" in sys.argv:
        for kind in KINDS:
            cycle(kind, 60 if kind == "image" else 20, publish=False)
        return 0
    end = time.time() + HOURS * 3600
    idle = {k: 0 for k in KINDS}
    while time.time() < end:
        did = False
        for kind in KINDS:
            if time.time() >= end:
                break
            try:
                r = cycle(kind, BATCH[kind], publish=True)
            except Exception as exc:                        # one bad source/network blip must not end the day's work
                print(f"⚠ {kind}: {type(exc).__name__}: {str(exc)[:160]}", flush=True)
                time.sleep(120)
                continue
            if r["written"] == 0 and r["exhausted"]:
                idle[kind] += 1
            else:
                did = True
        if not did:
            time.sleep(600)
    print("انتهى وقت الدورة:", time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
