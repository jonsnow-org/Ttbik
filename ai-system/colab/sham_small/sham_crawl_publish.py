"""
Where the engineer's crawl notebook (Wikipedia + news feeds; text, image,
audio and video) publishes — one call at the end of that notebook:

    import sham_crawl_publish
    sham_crawl_publish.publish()

  • the trained model → sham-crawl-checkpoint
      final.pt + the text tokenizer + the image/audio tokenizers it trained
      with + crawl_progress.json. The chat stage fetches it automatically,
      passes it through the repair stage (sham_repair.py) and then the
      guarded merge gate (sham_merge.py) — it enters Sham only if it
      improves every skill together.
  • the crawled data (optional, corpus_dir) → sham-crawl-corpus
      text/**/*.txt  (one article per file) — used automatically by text
      rehearsal in the chat stage; image/, audio/, video/ kept as they are.

It never publishes into a stage's own dataset (sham-multimodal-checkpoint,
sham-chat-checkpoint, ...) — that is what once replaced stage 2's files.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

MODEL_DATASET = "sham-crawl-checkpoint"
CORPUS_DATASET = "sham-crawl-corpus"
WORK = Path("/kaggle/working")
TOKENIZER_FILES = ("sham_small_tokenizer.json", "image_tokenizer.pt", "audio_tokenizer.pt")


def _find(name: str, near: Path) -> Path | None:
    for root in (near, WORK, WORK / "checkpoints"):
        if (root / name).exists():
            return root / name
    found = sorted(WORK.rglob(name))
    return found[0] if found else None


def publish(checkpoint: str | Path | None = None, corpus_dir: str | Path | None = None,
            message: str | None = None, name: str | None = None) -> dict:
    """name: this notebook's own name (e.g. "news" → sham-crawl-news and
    sham-crawl-news-corpus). Every sham-crawl-* dataset is found and merged
    by the chat stage automatically; two notebooks must not share a name."""
    from sham_inputs import publish_dataset
    from sham_live import dataset_names

    model_ds, corpus_ds = dataset_names(name)

    checkpoint = Path(checkpoint or WORK / "checkpoints/final.pt")
    if not checkpoint.exists():
        raise FileNotFoundError(f"لا توجد نقطة حفظ في {checkpoint}")
    out = WORK / "for_crawl_publish"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    shutil.copy2(checkpoint, out / "final.pt")
    missing = []
    for name in TOKENIZER_FILES:
        src = _find(name, checkpoint.parent)
        if src:
            shutil.copy2(src, out / name)
        else:
            missing.append(name)
    if "sham_small_tokenizer.json" in missing:
        raise FileNotFoundError("أداة تقسيم النص sham_small_tokenizer.json غير موجودة — بدونها لا يُعرف معنى أوزان النص.")
    if missing:
        print(f"⚠ غير موجودة: {', '.join(missing)} — صفوف الصورة/الصوت ستُحيَّد عند الدمج.")
    import torch
    step = int(torch.load(checkpoint, map_location="cpu", weights_only=False).get("step", 0) or 0)
    (out / "crawl_progress.json").write_text(json.dumps({"step": step}), encoding="utf-8")
    result = {"model": publish_dataset(out, model_ds, message or f"crawl model at step {step:,}")}

    if corpus_dir and Path(corpus_dir).exists() and any(Path(corpus_dir).iterdir()):
        n_txt = len(list(Path(corpus_dir).rglob("text/**/*.txt")))
        if not n_txt:
            print("⚠ لا توجد نصوص تحت text/ — التذكّر النصي لن يستفيد منها (المتوقع: text/<اسم>.txt).")
        result["corpus"] = publish_dataset(Path(corpus_dir), corpus_ds, message or f"crawl corpus ({n_txt:,} texts)")
    return result
