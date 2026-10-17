"""
Decoder-only refinement of the image / audio tokenizer (2026-10-17, owner: «نفّذه الآن»).

Why: the Studio writes a picture by letting the language model write image token ids and the tokenizer's DECODER turn them into pixels. The tokenizer that
travels with the merged model has had very little training, so even correct codes decode to flat, near-white pictures; and the pairing is frozen on purpose:
a different tokenizer gives the same ids another meaning, and everything the language model learned about those ids would be lost.

What this does instead: it trains ONLY the decoder (sham_vq_train.train_stream(decoder_only=True)). The encoder and the codebook are not touched, so every image
or sound is encoded into exactly the same ids as before — the language model stays valid — while what is decoded from them gets better.

Safety (never go backwards):
  * the start point is the published refined tokenizer when its encoder + codebook are bit-identical to the merged model's, else the merged model's own;
  * reconstruction error is measured on ONE fixed sample before and after (tokenizer_select.default_measure); the result is published only when it is
    better by at least SHAM_REFINE_MIN_GAIN (default 2%), and only after the ids of a probe batch are checked to be identical;
  * it publishes to its OWN dataset (sham-media-refined); the merge job adopts it only when the front is identical (adopt_refined below).

  python sham_decoder_refine.py image 230       # kind, minutes
Offline self-test: python sham_decoder_refine.py --selftest
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

import torch

REFINED = "sham-media-refined"
BASE = "sham-merged-checkpoint"
FILE = {"image": "image_tokenizer.pt", "audio": "audio_tokenizer.pt"}


def same_front(a, b) -> bool:
    """True when two tokenizers encode everything into the same ids: identical encoder and codebook weights."""
    sa, sb = a.state_dict(), b.state_dict()
    keys = [k for k in sa if k.startswith(("encoder", "quantizer"))]
    if set(keys) != {k for k in sb if k.startswith(("encoder", "quantizer"))}:
        return False
    return all(sa[k].shape == sb[k].shape and torch.equal(sa[k], sb[k]) for k in keys)


def _save(kind: str, path: Path, tok, step: int) -> None:
    if kind == "image":
        from train_image_tokenizer import save_tokenizer_checkpoint
    else:
        from train_audio_tokenizer import save_tokenizer_checkpoint
    save_tokenizer_checkpoint(path, tok, step)


def _load(kind: str, path: Path):
    from tokenizer_select import robust_load
    loaded = robust_load(str(path), kind)
    return loaded[0], int(loaded[1] or 0)


def refine(kind: str, minutes: float, fetch=None, publish=None, measure=None, manifest_builder=None, trainer=None, min_gain: float | None = None,
           work: Path | None = None) -> dict:
    """One refinement session. All the outside world (Kaggle, the media factory, the trainer) is injectable for the self-test."""
    from sham_inputs import fetch_dataset, publish_dataset
    fetch = fetch or fetch_dataset
    publish = publish or publish_dataset
    min_gain = float(os.environ.get("SHAM_REFINE_MIN_GAIN", "0.02")) if min_gain is None else min_gain
    work = work or Path(tempfile.mkdtemp(prefix="refine_"))
    out = {"kind": kind, "published": False}

    base_root = fetch(BASE)
    base_files = sorted(base_root.rglob(FILE[kind])) if base_root else []
    if not base_files:
        out["why"] = f"لا {FILE[kind]} في {BASE}"
        return out
    base, base_step = _load(kind, base_files[0])
    start, start_step, src = base, base_step, BASE
    refined_root = fetch(REFINED)
    refined_files = sorted(refined_root.rglob(FILE[kind])) if refined_root else []
    if refined_files:
        prev, prev_step = _load(kind, refined_files[0])
        if same_front(prev, base):
            start, start_step, src = prev, prev_step, REFINED
        else:
            print("⚠ المُرمِّز المصقول القديم لا يطابق ترميز النموذج المدموج الآن (الترميز تغيّر): يُبدأ من المدموج")
    print(f"🔧 {kind}: نقطة البدء من {src} (خطوة {start_step})")

    if measure is None:
        from tokenizer_select import default_measure
        measure = default_measure(kind)
    if measure is None:
        out["why"] = "لا عيّنة قياس (مصنع الوسائط غير متاح) — لا تدريب بلا ميزان"
        return out
    err_before = measure(start)
    if err_before is None:
        out["why"] = "تعذّر القياس قبل التدريب"
        return out

    if manifest_builder is None:
        from sham_media_shards import with_factory
        manifest_builder = lambda: with_factory(kind, None, str(work), k=2, limit=4000, seed=int(time.time()) // 3600)
    manifest = manifest_builder()
    if not manifest:
        out["why"] = "لا صور/أصوات للتدريب في المصنع"
        return out
    if trainer is None:
        from sham_vq_train import train_stream
        trainer = lambda tok: train_stream(tok, manifest, minutes=minutes, batch_size=16 if kind == "image" else 24, lr=2e-4, workers=2,
                                           warmup=50, kind=kind, res_mix={64: .55, 128: .30, 256: .15} if kind == "image" else None,
                                           decoder_only=True)
    candidate = _clone(kind, start)
    stats = trainer(candidate)
    candidate.train(False)
    if not same_front(candidate, start):
        out["why"] = "الترميز تغيّر أثناء التدريب — يُرفض (لا يجوز أن يتغيّر)"
        return out
    err_after = measure(candidate)
    out.update(before=err_before, after=err_after, steps=getattr(stats, "steps", 0))
    if err_after is None or err_after > err_before * (1 - min_gain):
        out["why"] = f"لم يتحسّن بما يكفي: {err_before:.4f} → {err_after if err_after is None else round(err_after, 4)} (الحد {min_gain:.0%})"
        print("⏭ " + out["why"])
        return out

    up = work / "upload"
    up.mkdir(parents=True, exist_ok=True)
    for k, name in FILE.items():                   # keep the other kind's file of the last refined version
        if k != kind and refined_files:
            other = sorted(refined_root.rglob(name))
            if other:
                shutil.copy2(other[0], up / name)
    _save(kind, up / FILE[kind], candidate, start_step + out["steps"])
    out["published"] = bool(publish(up, REFINED, f"{kind}: decoder-only refinement, reconstruction {err_before:.4f} → {err_after:.4f}"))
    print(f"✅ {kind}: إعادة البناء {err_before:.4f} → {err_after:.4f} ({(1 - err_after / err_before) * 100:.1f}% أفضل)، الرموز كما هي — نُشر في {REFINED}")
    return out


def _clone(kind: str, tok):
    import copy
    return copy.deepcopy(tok)


def adopt_refined(up: Path, base_dir: Path, fetch, log=print) -> list[str]:
    """Merge-job hook: after the merged model's tokenizers were copied into `up`, replace each with the refined one when (and only when) it encodes into
    exactly the same ids (identical encoder + codebook). Returns the kinds adopted."""
    adopted = []
    try:
        root = fetch(REFINED)
        if not root:
            return adopted
        for kind, name in FILE.items():
            ref = sorted(root.rglob(name))
            cur = up / name
            if not ref or not cur.exists():
                continue
            a, _ = _load(kind, ref[0])
            b, _ = _load(kind, cur)
            if same_front(a, b):
                shutil.copy2(ref[0], cur)
                adopted.append(kind)
                log(f"🖼 {kind}: مفكّ مصقول معتمد (نفس الترميز تماماً)")
            else:
                log(f"⏭ {kind}: المُرمِّز المصقول لا يطابق ترميز النموذج — لا يُعتمد")
    except Exception as exc:
        log(f"⚠ تعذّر اعتماد المُرمِّز المصقول ({type(exc).__name__}): {str(exc)[:100]}")
    return adopted


def _selftest() -> None:
    from image_tokenizer import ImageTokenizer, ImageTokenizerConfig
    from train_image_tokenizer import save_tokenizer_checkpoint
    torch.manual_seed(0)
    cfg = ImageTokenizerConfig(image_size=32, base_channels=8, channel_multipliers=(1, 2), code_dim=8, num_codes=64)
    base = ImageTokenizer(cfg)
    data = torch.randn(32, 3, 8, 8)
    data = torch.nn.functional.interpolate(data, size=32, mode="bicubic", align_corners=False).clamp(-2, 2) / 2
    td = Path(tempfile.mkdtemp())
    (td / "base").mkdir()
    save_tokenizer_checkpoint(td / "base" / "image_tokenizer.pt", base, 5)
    published = {}

    def fetch(name):
        return (td / "base") if name == BASE else (published.get("dir") if name == REFINED else None)

    def publish(up, name, msg):
        d = td / "pub"
        shutil.rmtree(d, ignore_errors=True)
        shutil.copytree(up, d)
        published["dir"] = d
        return True

    from sham_vq_train import train_stream
    from PIL import Image
    mdir = td / "m"
    mdir.mkdir()
    for i in range(32):
        arr = ((data[i].permute(1, 2, 0).numpy() + 1) * 127.5).clip(0, 255).astype("uint8")
        Image.fromarray(arr).save(mdir / f"{i}.png")
    (mdir / "manifest.jsonl").write_text("\n".join('{"image": "%d.png", "caption": "x"}' % i for i in range(32)), encoding="utf-8")

    def measure(tok):
        tok.train(False)
        with torch.no_grad():
            return float(((tok.decode(tok.encode(data)) - data) ** 2).mean())
    trainer = lambda tok: train_stream(tok, mdir / "manifest.jsonl", minutes=5, batch_size=8, max_steps=150, workers=0, warmup=5, log_every=75,
                                       decoder_only=True, size=32)
    r = refine("image", 5, fetch=fetch, publish=publish, measure=measure, manifest_builder=lambda: str(mdir / "manifest.jsonl"), trainer=trainer,
               min_gain=0.02, work=td / "w")
    assert r["published"] and r["after"] < r["before"], r
    up = td / "up"
    up.mkdir()
    shutil.copy2(td / "base" / "image_tokenizer.pt", up / "image_tokenizer.pt")
    assert adopt_refined(up, td / "base", fetch) == ["image"]
    new, _ = _load("image", up / "image_tokenizer.pt")
    assert same_front(new, base) and measure(new) < measure(base)
    # a refined file whose codes differ is never adopted
    other = ImageTokenizer(cfg)
    save_tokenizer_checkpoint(up / "image_tokenizer.pt", other, 1)
    assert adopt_refined(up, td / "base", fetch) == []
    print("sham_decoder_refine self-test OK")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest" or len(sys.argv) < 3:
        _selftest()
    else:
        result = refine(sys.argv[1], float(sys.argv[2]))
        print(result)
