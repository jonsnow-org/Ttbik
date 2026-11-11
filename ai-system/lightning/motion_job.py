"""Motion-tokenizer training job (the codec that turns the change between two frames into motion tokens), for a CPU Studio or any machine with Kaggle keys.

Sham's video is one keyframe plus motion tokens decoded by this codec; without a trained one the model answers "no video" (sham_studio_media.NO_VIDEO). The Kaggle video notebook trains it
inside a long session; this job is the same recipe as a resumable loop so a free CPU Studio can do it too, and keep improving it:

  1. resume from the newest published motion tokenizer (dataset sham-motion-tokenizer-checkpoint, else the one the video corpus carries), else a new one
  2. collect real short clips (sham_data_sources.collect "video", de-duplicated by its ledger), take consecutive frame pairs
  3. train in rounds (train_motion_tokenizer) until it beats the copy-the-previous-frame baseline (a slideshow is refused) or the time is up
  4. publish motion_tokenizer.pt + motion_tokenizer_progress.json to sham-motion-tokenizer-checkpoint

    python motion_job.py        (SHAM_MOTION_HOURS, default 3.0)       python motion_job.py --selftest
Nothing here prints a secret; it publishes only when the run improved the baseline test (beats_slideshow) or there was no tokenizer yet.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
for _p in (HERE.parent / "colab" / "sham_small", HERE, HERE.parent / "sham_small", HERE / "sham_small"):
    if _p.is_dir():
        sys.path.insert(0, str(_p))

WORK = Path(os.environ.get("SHAM_FACTORY_DIR", str(Path.home() / "sham_factory"))) / "motion"
HOURS = float(os.environ.get("SHAM_MOTION_HOURS", "3.0"))
MAX_VIDEOS = int(os.environ.get("SHAM_MOTION_VIDEOS", "300"))
MAX_PAIRS = int(os.environ.get("SHAM_MOTION_PAIRS", "3000"))
DATASET = "sham-motion-tokenizer-checkpoint"


def frame_pairs(frames: list, limit: int) -> tuple[list, list]:
    """Consecutive (previous, next) tensors of one clip, at most `limit` pairs."""
    prevs, nexts = [], []
    for i in range(len(frames) - 1):
        if len(prevs) >= limit:
            break
        prevs.append(frames[i])
        nexts.append(frames[i + 1])
    return prevs, nexts


def load_start():
    """(tokenizer, step): resume the newest published one, else a new one."""
    import json as _json
    from motion_tokenizer import MotionTokenizer, MotionTokenizerConfig, load_motion_tokenizer
    try:
        from sham_inputs import fetch_dataset, rglob_inputs
        for name in (DATASET, "sham-video-corpus"):
            try:
                fetch_dataset(name)
            except Exception as exc:                      # a missing dataset is normal on the first run
                print(f"  (no {name}: {type(exc).__name__})")
        found = sorted(rglob_inputs("motion_tokenizer.pt"))
        if found:
            tok = load_motion_tokenizer(found[-1])
            step = 0
            try:
                step = int(_json.loads((Path(found[-1]).parent / "motion_tokenizer_progress.json").read_text()).get("step", 0))
            except Exception:
                pass
            print(f"resumed from {found[-1]} (step {step:,})")
            return tok, step
    except Exception as exc:
        print(f"resume skipped: {type(exc).__name__}: {str(exc)[:120]}")
    print("no earlier motion tokenizer: starting a new one")
    return MotionTokenizer(MotionTokenizerConfig()), 0


def train_round(tok, prev_t, next_t, block: int, batch: int):
    from train_motion_tokenizer import train_motion_tokenizer
    return train_motion_tokenizer(tok, prev_t, next_t, num_epochs=1, batch_size=batch, block=block, log_every=1000)


def publish(tok, step: int, stats) -> str | None:
    import shutil
    from motion_tokenizer import save_motion_tokenizer
    from sham_inputs import publish_dataset
    out = WORK / "upload"
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    save_motion_tokenizer(out / "motion_tokenizer.pt", tok.cpu(), step=step)
    (out / "motion_tokenizer_progress.json").write_text(json.dumps({
        "step": step, "codebook_usage": stats.final_codebook_usage, "codebook_size": stats.codebook_size,
        "copy_previous_error": stats.copy_previous_error, "trained_error": stats.trained_error, "beats_slideshow": bool(stats.beats_copy)}), encoding="utf-8")
    return publish_dataset(out, DATASET, f"motion tokenizer step {step:,}: {stats.trained_error:.4f} vs copy-previous {stats.copy_previous_error:.4f}")


def main() -> int:
    import torch
    from PIL import Image
    from sham_data_sources import Ledger, collect
    from tokenizer_select import select_pretrained_tokenizer
    torch.set_num_threads(int(os.environ.get("SHAM_TOK_THREADS", "2")))
    WORK.mkdir(parents=True, exist_ok=True)
    tok, step = load_start()
    image_tok = select_pretrained_tokenizer("image")
    size = int(image_tok.cfg.image_size) if image_tok else 256
    block = tok.flow_block(size, None) if hasattr(tok, "flow_block") else size // tok.cfg.grid
    deadline = time.time() + HOURS * 3600
    last = None
    while time.time() < deadline - 900:
        ledgers = WORK / "ledgers"
        ledgers.mkdir(exist_ok=True)
        ledger = Ledger.load("video", search_root=ledgers, name="motion_video")
        out = WORK / f"clips_{time.strftime('%Y%m%d%H%M', time.gmtime())}"
        manifest, stats_c = collect("video", out, MAX_VIDEOS, ledger, image_size=size, num_frames=8)
        try:
            ledger.save(ledgers)
        except Exception:
            pass
        root = Path(manifest).parent
        prevs, nexts = [], []
        with open(manifest, encoding="utf-8") as fh:
            for line in fh:
                rec = json.loads(line)
                ts = [torch.from_numpy(__import__("numpy").asarray(Image.open(root / fp).convert("RGB").resize((size, size)), dtype="float32").copy()).permute(2, 0, 1) / 127.5 - 1.0
                      for fp in (rec.get("frames") or [])]
                p, n = frame_pairs(ts, MAX_PAIRS - len(prevs))
                prevs += p
                nexts += n
                if len(prevs) >= MAX_PAIRS:
                    break
        if len(prevs) < 2:
            print("no frame pairs this round; waiting")
            time.sleep(600)
            continue
        prev_t, next_t = torch.stack(prevs), torch.stack(nexts)
        t0 = time.time()
        while time.time() - t0 < max(300, (deadline - time.time()) * 0.7):
            last = train_round(tok, prev_t, next_t, block, 8)
            step += 1
            if last.beats_copy:
                break
        print(f"round: copy-previous {last.copy_previous_error:.4f} -> trained {last.trained_error:.4f}, codes {last.final_codebook_usage}/{last.codebook_size}", flush=True)
        if last.beats_copy:
            print("published:", publish(tok, step, last), flush=True)
        else:
            print("not published: it does not beat a slideshow yet (more clips or time next round)", flush=True)
    return 0


def selftest() -> int:
    import torch
    from motion_tokenizer import MotionTokenizer, MotionTokenizerConfig
    from train_motion_tokenizer import make_synthetic_motion_dataset
    assert frame_pairs([1, 2, 3, 4], 2) == ([1, 2], [2, 3]) and frame_pairs([1], 5) == ([], [])
    tok = MotionTokenizer(MotionTokenizerConfig(grid=2, num_codes=16))
    prev, nxt = make_synthetic_motion_dataset(8, 16, 8)
    s = train_round(tok, prev, nxt, 8, 4)
    assert s.codebook_size == 16 and s.copy_previous_error > 0
    print("motion_job self-test OK")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv or not (os.environ.get("KAGGLE_USERNAME") or os.environ.get("KAGGLE_API_TOKEN")):
        sys.exit(selftest())
    code = main()
    sys.stdout.flush()
    os._exit(code)
