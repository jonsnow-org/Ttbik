"""
Image-tokenizer booster — what the owner's standalone notebook
(notebook04b758ffb5, "UncensoredImageTokenizer") becomes, instead of being
deleted. That notebook trained its own tiny autoencoder with no codebook, a
file Sham's model could never use. Now its training cell only calls run() here,
so it trains THE SAME image tokenizer Sham speaks with, in the same lineage as
the scheduled image-tokenizer track:

  1. resumes the most-trained healthy tokenizer from
     sham-image-tokenizer-checkpoint (latest version, fetched automatically);
  2. collects NEW real images with the SAME ledger as the track (no image is
     ever collected twice by either notebook);
  3. trains with codebook revival (sham_vq.py) — on the GPU when the notebook
     has one, so a manual GPU run moves the tokenizer much faster than the
     scheduled CPU track;
  4. publishes back to the same dataset, but only if nobody else published
     meanwhile (optimistic check), so it can never overwrite the track's work;
  5. prints live codes, codebook usage and reconstruction PSNR, and saves a
     before/after picture (original | reconstruction) to /kaggle/working.

All later improvements happen here, in the repository — the notebook itself
never needs another edit or import.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

import torch

DATASET = "sham-image-tokenizer-checkpoint"
WORK = Path("/kaggle/working")


def _strip_token_from_clone(clone_dir: Path = WORK / "Ttbik") -> None:
    """The notebook's own clone cell leaves GITHUB_TOKEN inside .git/config,
    which ends up in the notebook's Output. Remove it."""
    if (clone_dir / ".git").exists():
        subprocess.run(["git", "-C", str(clone_dir), "remote", "set-url", "origin",
                        "https://github.com/jonsnow-org/Ttbik.git"], check=False)


def _progress(root: Path | None) -> dict:
    if not root:
        return {}
    for p in sorted(Path(root).rglob("image_tokenizer_progress.json")):
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _load_images(manifest: str, size: int) -> torch.Tensor:
    from PIL import Image
    import numpy as np

    root = Path(manifest).parent
    out = []
    for line in open(manifest, encoding="utf-8"):
        rec = json.loads(line)
        img = Image.open(root / rec["image"]).convert("RGB").resize((size, size))
        out.append(torch.from_numpy(np.asarray(img, dtype="float32")).permute(2, 0, 1) / 127.5 - 1.0)
    return torch.stack(out) if out else torch.empty(0, 3, size, size)


def _save_comparison(tok, images: torch.Tensor, path: Path) -> None:
    from PIL import Image
    import numpy as np

    with torch.no_grad():
        rec = tok.decode(tok.encode(images))
    to_u8 = lambda t: ((t.clamp(-1, 1) + 1) * 127.5).byte().permute(0, 2, 3, 1).numpy()
    a, b = to_u8(images), to_u8(rec)
    rows = [np.concatenate([x, y], axis=1) for x, y in zip(a, b)]
    Image.fromarray(np.concatenate(rows, axis=0)).save(path)


def run(max_images: int = 1500, minutes: float | None = None) -> dict:
    from image_tokenizer import ImageTokenizer, ImageTokenizerConfig
    from sham_data_sources import Ledger, collect
    from sham_inputs import fetch_dataset, publish_dataset
    from sham_vq import live_codes, reconstruction_psnr, train_vq_revive
    from tokenizer_select import select_pretrained_tokenizer
    from train_image_tokenizer import save_tokenizer_checkpoint

    _strip_token_from_clone()
    device = "cuda" if torch.cuda.is_available() else "cpu"
    minutes = minutes or (60 if device == "cuda" else 45)
    print(f"معزّز أداة ترميز الصورة — الجهاز: {device}، مدة التدريب: {minutes:.0f} دقيقة")

    # 1) the lineage's latest, most-trained healthy tokenizer
    start_root = fetch_dataset(DATASET, fresh=True)
    start = _progress(start_root)
    picked = select_pretrained_tokenizer("image")
    if picked:
        tok, step, path = picked
        print(f"الاستئناف من: {path} (خطوة {step:,})")
    else:
        tok, step = ImageTokenizer(ImageTokenizerConfig()), 0
        print("لا توجد أداة سابقة — بدء أداة جديدة.")
    size = tok.cfg.image_size

    # 2) new images, shared ledger with the scheduled track
    ledger = Ledger.load("image")
    manifest, stats = collect("image", str(WORK / "corpus/images_booster"), max_images, ledger, image_size=size)
    images = _load_images(manifest, size)
    if images.shape[0] < 64:
        print("⚠ صور جديدة قليلة جداً — لا تدريب هذه المرة.")
        return {"trained": False}
    held, train_set = images[:32], images[32:]
    before = {"live": live_codes(tok), "psnr": reconstruction_psnr(tok, held)}

    # 3) codebook-revival training within the time budget
    t0 = time.time()
    tstats = train_vq_revive(tok, train_set, num_epochs=10_000, batch_size=16 if device == "cuda" else 8,
                             device=device, log_every=5, time_limit_seconds=minutes * 60)
    after = {"live": live_codes(tok), "psnr": reconstruction_psnr(tok, held),
             "usage": tstats.final_codebook_usage}
    print(f"قبل: رموز حيّة {before['live']:,}/8,192، PSNR {before['psnr']:.1f}dB")
    print(f"بعد: رموز حيّة {after['live']:,}/8,192، استخدام القاموس {after['usage']:,}/8,192، "
          f"PSNR {after['psnr']:.1f}dB ({(time.time() - t0) / 60:.0f} دقيقة)")
    _save_comparison(tok, held[:8], WORK / "image_tokenizer_before_after.png")
    print(f"صورة المقارنة (الأصل | إعادة البناء): {WORK / 'image_tokenizer_before_after.png'}")

    # 4) publish into the same lineage — unless someone published meanwhile
    out = WORK / "for_dataset_upload"
    out.mkdir(parents=True, exist_ok=True)
    new_step = int(step or 0) + len(tstats.epoch_losses)
    samples = int(start.get("samples_consumed") or 0) + int(stats.written)
    save_tokenizer_checkpoint(out / "image_tokenizer.pt", tok, step=new_step)
    (out / "image_tokenizer_progress.json").write_text(json.dumps(
        {"samples_consumed": samples, "step": new_step, "last_run_sources": stats.per_source, "by": "booster"}))
    latest = _progress(fetch_dataset(DATASET, fresh=True))
    if latest and latest != start:
        print("⚠ نشر مسار ترميز الصورة نسخة أحدث أثناء هذا التشغيل — لم يُنشر فوقها. "
              "النتيجة محفوظة في Output هذه الجلسة، والتشغيل القادم يبدأ من الأحدث.")
        return {"trained": True, "published": False, **after}
    ledger.save(out)
    published = publish_dataset(out, DATASET, f"booster at step {new_step:,}")
    return {"trained": True, "published": bool(published), **after}


if __name__ == "__main__" and os.environ.get("SHAM_BOOSTER_SELFTEST"):
    print(run(max_images=100, minutes=0.2))
