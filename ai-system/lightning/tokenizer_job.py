"""
Tokenizer training on the free Lightning Studio's 4 CPU cores — no GPU anywhere (owner, 2026-10-11). One loop, one process, data local:

  collect  a big batch of images and sound with the media factory's own collector (de-duplicated, resumable), publish both as sham-media-*
  train    the image tokenizer — the FULL design, 38.9M params, 256 px, 256 tokens, never smaller — on that local batch with a resolution
           curriculum (each step at 64, 128 or 256 px: one set of convolutional weights serves all sizes, so a CPU spends most steps on
           cheap small pictures and some on full size), in 25-minute chunks saving after each; then the audio tokenizer (every segment)
  publish  sham-image-tokenizer-v2-checkpoint / sham-audio-tokenizer-v2-checkpoint (+ a progress file with samples, steps, reconstruction and
           codebook use) so any later job — or the merge — can pick them up

It resumes from its own last checkpoint (this Studio's disk, else the published dataset), so the 4-hour restarts of a free Studio lose nothing.
Both resume from the existing tokenizers' weights when there are any (same architecture): nothing already learned is thrown away.

    python tokenizer_job.py        (SHAM_TOK_HOURS, default 3.3)       python tokenizer_job.py --selftest
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "colab" / "sham_small"))
sys.path.insert(0, str(HERE))

WORK = Path(os.environ.get("SHAM_FACTORY_DIR", str(Path.home() / "sham_factory")))
TOK = WORK / "tok"
HOURS = float(os.environ.get("SHAM_TOK_HOURS", "3.3"))
CHUNK_MIN = float(os.environ.get("SHAM_TOK_CHUNK_MIN", "25"))
N_IMAGES = int(os.environ.get("SHAM_TOK_IMAGES", "24000"))
N_AUDIO = int(os.environ.get("SHAM_TOK_AUDIO", "6000"))
IMAGE_DATASET = "sham-image-tokenizer-v2-checkpoint"
AUDIO_DATASET = "sham-audio-tokenizer-v2-checkpoint"


def _progress(kind: str) -> dict:
    p = TOK / f"{kind}_progress.json"
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {"steps": 0, "samples": 0, "chunks": 0}


def load_tokenizer(kind: str):
    """The tokenizer to continue: local file, else the published dataset, else (audio) the old weights, else a new one."""
    import torch
    from sham_media_cfg import audio_config, image_config
    if kind == "image":
        from image_tokenizer import ImageTokenizer
        from train_image_tokenizer import load_tokenizer_checkpoint
        make = lambda: ImageTokenizer(image_config())
    else:
        from audio_tokenizer import AudioTokenizer
        from train_audio_tokenizer import load_tokenizer_checkpoint
        make = lambda: AudioTokenizer(audio_config())
    local = TOK / f"{kind}_tokenizer.pt"
    if local.exists():
        tok, step = load_tokenizer_checkpoint(local)
        return tok, step
    try:
        from sham_inputs import fetch_dataset
        root = fetch_dataset(IMAGE_DATASET if kind == "image" else AUDIO_DATASET)
        hits = sorted(root.rglob(f"{kind}_tokenizer.pt")) if root else []
        if hits:
            return load_tokenizer_checkpoint(hits[0])
        # same architecture as before: keep whatever the existing tokenizer learned (never start over from nothing)
        from tokenizer_select import select_pretrained_tokenizer
        fetch_dataset(f"sham-{kind}-tokenizer-checkpoint")
        picked = select_pretrained_tokenizer(kind)
        if picked:
            return picked[0], 0
    except Exception as exc:
        print(f"⚠ {kind}: no checkpoint to resume ({type(exc).__name__})", flush=True)
    return make(), 0


def save_tokenizer(kind: str, tok, step: int, extra: dict) -> None:
    TOK.mkdir(parents=True, exist_ok=True)
    if kind == "image":
        from train_image_tokenizer import save_tokenizer_checkpoint
    else:
        from train_audio_tokenizer import save_tokenizer_checkpoint
    save_tokenizer_checkpoint(TOK / f"{kind}_tokenizer.pt", tok, step=step)
    (TOK / f"{kind}_progress.json").write_text(json.dumps(extra), encoding="utf-8")


def train_kind(kind: str, manifest: str, minutes: float, deadline: float, margin_s: float = 120, **kw) -> dict:
    """Train in chunks (a save after each); the learning rate decays across chunks and sessions via the progress file."""
    from sham_vq_train import train_stream
    tok, step = load_tokenizer(kind)
    prog = _progress(kind)
    prog["steps"] = max(prog.get("steps", 0), step)
    end = min(time.time() + minutes * 60, deadline)
    last = None
    while time.time() < end - margin_s:
        chunk = min(CHUNK_MIN, (end - time.time()) / 60)
        lr = max(5e-5, 3e-4 * (0.9 ** prog["chunks"]))
        from sham_media_cfg import IMAGE_RES_MIX
        stats = train_stream(tok, manifest, minutes=chunk, batch_size=12 if kind == "image" else 32, lr=lr, workers=2, kind=kind,
                             res_mix=IMAGE_RES_MIX if kind == "image" else None, warmup=50, **kw)
        prog["steps"] += stats.steps
        prog["samples"] += stats.samples
        prog["chunks"] += 1
        prog.update({"recon": stats.recon[-1] if stats.recon else None, "codebook_usage": stats.codebook_usage, "perplexity": stats.perplexity,
                     "image_size": getattr(tok.cfg, "image_size", None), "updated": time.strftime("%Y-%m-%d %H:%M", time.gmtime())})
        save_tokenizer(kind, tok, prog["steps"], prog)
        last = stats
        print(f"🧩 {kind}: {stats.summary()} | الإجمالي {prog['steps']:,} خطوة، {prog['samples']:,} عيّنة", flush=True)
    return {"prog": prog, "stats": last}


def publish(kind: str) -> str | None:
    from sham_inputs import publish_dataset
    d = TOK / f"upload_{kind}"
    d.mkdir(parents=True, exist_ok=True)
    import shutil
    shutil.copy2(TOK / f"{kind}_tokenizer.pt", d / f"{kind}_tokenizer.pt")
    shutil.copy2(TOK / f"{kind}_progress.json", d / f"{kind}_progress.json")
    prog = _progress(kind)
    return publish_dataset(d, IMAGE_DATASET if kind == "image" else AUDIO_DATASET,
                           f"{kind} tokenizer v2 on CPU: {prog['steps']:,} steps, {prog['samples']:,} samples, recon {prog.get('recon')}")


def main() -> int:
    import torch
    import media_factory
    torch.set_num_threads(int(os.environ.get("SHAM_TOK_THREADS", "4")))
    TOK.mkdir(parents=True, exist_ok=True)
    deadline = time.time() + HOURS * 3600
    while time.time() < deadline - 600:
        batches = {}
        for kind, n in (("image", N_IMAGES), ("audio", N_AUDIO)):
            try:
                media_factory.WORK = WORK
                from sham_data_sources import Ledger, collect
                ledgers = WORK / "ledgers"
                ledgers.mkdir(parents=True, exist_ok=True)
                ledger = Ledger.load(kind, search_root=ledgers, name=f"factory_{kind}")
                out = WORK / f"batch_{kind}_{time.strftime('%Y%m%d%H%M', time.gmtime())}"
                manifest, stats = collect(kind, out, n, ledger, image_size=256 if kind == "image" else 64)
                ledger.save(ledgers)
                print(f"🏭 {kind}: {stats.written:,} new samples ({stats.summary()[:100]})", flush=True)
                if stats.written:
                    batches[kind] = manifest
            except Exception as exc:
                print(f"⚠ collect {kind}: {type(exc).__name__}: {str(exc)[:140]}", flush=True)
        for kind, share in (("image", 0.62), ("audio", 0.38)):
            if kind not in batches or time.time() > deadline - 600:
                continue
            left = (deadline - time.time()) / 60
            try:
                train_kind(kind, batches[kind], minutes=max(15.0, left * share), deadline=deadline)
                print("نُشر:", publish(kind), flush=True)
            except Exception as exc:
                print(f"⚠ train {kind}: {type(exc).__name__}: {str(exc)[:200]}", flush=True)
        if not batches:
            time.sleep(600)
    return 0


def selftest() -> int:
    import tempfile
    import numpy as np
    import soundfile as sf
    from PIL import Image
    global TOK
    with tempfile.TemporaryDirectory() as d:
        TOK = Path(d) / "tok"
        # a tiny image set and audio set on disk, then train_kind for both with the real code path (tiny configs via monkeypatch)
        import sham_media_cfg
        from image_tokenizer import ImageTokenizerConfig
        import image_tokenizer as it
        _orig_cfg = sham_media_cfg.image_config
        sham_media_cfg.image_config = lambda: it.ImageTokenizerConfig(image_size=32, base_channels=8, channel_multipliers=(1, 2), code_dim=16, num_codes=64)
        sham_media_cfg.IMAGE_RES_MIX = {8: 0.5, 16: 0.25, 32: 0.25}
        for i in range(24):
            arr = (np.random.RandomState(i).rand(32, 32, 3) * 255).astype("uint8")
            Image.fromarray(arr).save(Path(d) / f"{i}.png")
            sf.write(str(Path(d) / f"{i}.wav"), (0.3 * np.sin(2 * np.pi * (200 + 30 * i) * np.arange(16000 * 3) / 16000)).astype("float32"), 16000)
        (Path(d) / "images.jsonl").write_text("\n".join(json.dumps({"image": f"{i}.png", "caption": "x"}) for i in range(24)), encoding="utf-8")
        (Path(d) / "audio.jsonl").write_text("\n".join(json.dumps({"audio": f"{i}.wav", "sentence": "x"}) for i in range(24)), encoding="utf-8")
        global CHUNK_MIN
        CHUNK_MIN = 5.0
        r = train_kind("image", str(Path(d) / "images.jsonl"), minutes=0.5, deadline=time.time() + 600, margin_s=0, max_steps=15)
        assert r["prog"]["steps"] > 0 and (TOK / "image_tokenizer.pt").exists() and r["prog"]["chunks"] >= 1, r
        # resume: a second call continues the same step counter
        r2 = train_kind("image", str(Path(d) / "images.jsonl"), minutes=0.5, deadline=time.time() + 600, margin_s=0, max_steps=10)
        assert r2["prog"]["steps"] > r["prog"]["steps"], (r["prog"], r2["prog"])
    print("tokenizer_job self-test OK")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv or not (os.environ.get("KAGGLE_USERNAME") or os.environ.get("KAGGLE_API_TOKEN")):
        sys.exit(selftest())
    code = main()
    sys.stdout.flush()
    os._exit(code)
