"""Train Sham Pro's motion tokenizer (the video codec) on REAL video and, with --publish, put it next to the checkpoint in novaai2026/sham-v2.

Why (2026-11-25): Sham Pro's video answered NO_VIDEO since 2026-11-22: serve._trained_motion_tokenizer finds no motion_tokenizer*.pt next to final_merged.pt,
because no motion tokenizer was ever trained for v2 (build_v2.py copies one only when it can find one). This trains it with the existing recipe
(train_motion_tokenizer.train_motion_tokenizer: real flow -> motion codebook -> warp + refine) on real clips (sham_data_sources, Kinetics-400 parts),
and it is published only when, on HELD-OUT clips it never trained on, it beats the copy-the-previous-frame baseline (a slideshow is refused).

    python scripts/transplant/train_sham_v2_motion.py --minutes 40 --out /tmp/motion            # train + report
    MODELSCOPE_TOKEN=... python scripts/transplant/train_sham_v2_motion.py --publish            # + upload to novaai2026/sham-v2 (motion_tokenizer.pt, progress json)
    python scripts/transplant/train_sham_v2_motion.py --selftest                                 # no network
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SHAM = ROOT / "ai-system" / "colab" / "sham_small"
sys.path.insert(0, str(SHAM))

import torch  # noqa: E402

MODEL_REPO = os.environ.get("SHAM_MS_MODEL", "novaai2026/sham-v2")


def load_clips(manifest: Path, size: int, limit: int = 10**9) -> list[list[torch.Tensor]]:
    import numpy as np
    from PIL import Image
    clips = []
    root = manifest.parent
    for line in manifest.read_text(encoding="utf-8").splitlines():
        rec = json.loads(line)
        frames = []
        for fp in rec.get("frames") or []:
            arr = np.asarray(Image.open(root / fp).convert("RGB").resize((size, size)), dtype="float32").copy()
            frames.append(torch.from_numpy(arr).permute(2, 0, 1) / 127.5 - 1.0)
        if len(frames) >= 2:
            clips.append(frames)
        if len(clips) >= limit:
            break
    return clips


def pairs(clips) -> tuple[torch.Tensor, torch.Tensor]:
    prev, nxt = [], []
    for fr in clips:
        for a, b in zip(fr[:-1], fr[1:]):
            prev.append(a)
            nxt.append(b)
    return torch.stack(prev), torch.stack(nxt)


@torch.no_grad()
def held_out(tok, prev, nxt) -> dict:
    """Errors on pairs the tokenizer never trained on (mean absolute error per pixel, frames in [-1, 1])."""
    block = tok.flow_block(prev.shape[-1], None)
    copy_err, trained_err, n = 0.0, 0.0, 0
    for i in range(0, prev.shape[0], 16):
        p, x = prev[i:i + 16], nxt[i:i + 16]
        rec = tok.decode_frame(p, tok.encode_pair(p, x, block))
        copy_err += (p - x).abs().mean().item() * p.shape[0]
        trained_err += (rec - x).abs().mean().item() * p.shape[0]
        n += p.shape[0]
    ids = tok.encode_pair(prev[:64], nxt[:64], block)
    return {"copy_previous_error": round(copy_err / n, 5), "trained_error": round(trained_err / n, 5),
            "beats_slideshow": trained_err < copy_err, "codes_used": int(torch.unique(ids).numel()), "pairs": n}


def train(clips, minutes: float, size: int, seed: int = 0, log=print):
    from model import MOTION_VOCAB_SIZE
    from motion_tokenizer import MotionTokenizer, MotionTokenizerConfig
    from train_motion_tokenizer import train_motion_tokenizer
    random.Random(seed).shuffle(clips)
    n_eval = max(1, len(clips) // 8)
    ev_p, ev_n = pairs(clips[:n_eval])
    tr_p, tr_n = pairs(clips[n_eval:])
    n_clips = len(clips)
    clips.clear()                                   # the frames now live only in the pair tensors (a 256px clip list + its pairs did not fit in 4 GB)
    log(f"clips: {n_clips} ({n_clips - n_eval} train / {n_eval} held out); pairs {tr_p.shape[0]} train / {ev_p.shape[0]} held out; {size}px")
    torch.manual_seed(seed)
    tok = MotionTokenizer(MotionTokenizerConfig(num_codes=MOTION_VOCAB_SIZE))
    deadline = time.time() + minutes * 60
    rounds, best = 0, None
    first = True
    while time.time() < deadline:
        stats = train_motion_tokenizer(tok, tr_p, tr_n, num_epochs=1, batch_size=16, log_every=1000, data_init=first,
                                       device="cpu")
        first = False
        rounds += 1
        ho = held_out(tok.eval(), ev_p, ev_n)
        tok.train()
        log(f"round {rounds}: train loss {stats.epoch_losses[-1]:.4f}; held-out copy-previous {ho['copy_previous_error']} -> trained {ho['trained_error']}, codes {ho['codes_used']}")
        if best is None or ho["trained_error"] < best[0]["trained_error"]:
            best = (ho, {k: v.detach().clone() for k, v in tok.state_dict().items()}, rounds)
    tok.load_state_dict(best[1])
    return tok.eval(), {**best[0], "rounds": rounds, "best_round": best[2], "train_pairs": int(tr_p.shape[0]), "image_size": size}


def publish(folder: Path) -> None:
    from modelscope.hub.api import HubApi
    api = HubApi()
    api.login(os.environ["MODELSCOPE_TOKEN"])
    for name in ("motion_tokenizer.pt", "motion_tokenizer_progress.json"):
        api.upload_file(path_or_fileobj=str(folder / name), path_in_repo=name, repo_id=MODEL_REPO, repo_type="model",
                        commit_message=f"Sham Pro: trained motion tokenizer ({name})")
        print(f"uploaded {name} -> {MODEL_REPO}", flush=True)


def selftest() -> int:
    from train_motion_tokenizer import make_synthetic_motion_dataset
    prev, nxt = make_synthetic_motion_dataset(24, 64, 8)
    clips = [[prev[i], nxt[i]] for i in range(prev.shape[0])]
    tok, rep = train(clips, 0.05, 64, log=lambda m: None)
    assert rep["pairs"] >= 1 and "beats_slideshow" in rep and tok.cfg.num_codes == 1024
    print("train_sham_v2_motion self-test OK", rep)
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=float(os.environ.get("SHAM_MOTION_MINUTES", "40")))
    ap.add_argument("--clips", type=int, default=int(os.environ.get("SHAM_MOTION_CLIPS", "160")))
    ap.add_argument("--size", type=int, default=256, help="frame size = Sham's image tokenizer size (256)")
    ap.add_argument("--out", default="/tmp/sham_v2_motion")
    ap.add_argument("--manifest", default="", help="an existing video manifest.jsonl (skip collecting)")
    ap.add_argument("--publish", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    torch.set_num_threads(os.cpu_count() or 2)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    manifest = Path(a.manifest) if a.manifest else None
    if manifest is None:
        from sham_data_sources import Ledger, collect
        t0 = time.time()
        m, st = collect("video", out / "clips", a.clips, Ledger("video"), image_size=a.size, num_frames=8)
        manifest = Path(m)
        print(f"collected {st.written} real clips in {time.time() - t0:.0f}s", flush=True)
    clips = load_clips(manifest, a.size, a.clips)
    if len(clips) < 8:
        print(f"only {len(clips)} usable clips: not training on so little", flush=True)
        return 2
    tok, rep = train(clips, a.minutes, a.size, log=lambda m: print(m, flush=True))
    from motion_tokenizer import save_motion_tokenizer
    save_motion_tokenizer(out / "motion_tokenizer.pt", tok, step=rep["rounds"])
    rep["trained_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rep["data"] = "Kinetics-400 clips (sham_data_sources), 8 frames each, held-out clips never trained on"
    (out / "motion_tokenizer_progress.json").write_text(json.dumps(rep, indent=1), encoding="utf-8")
    print("RESULT " + json.dumps(rep), flush=True)
    if not rep["beats_slideshow"]:
        print("not published: on held-out clips it does not beat copying the previous frame", flush=True)
        return 3
    if a.publish:
        publish(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
