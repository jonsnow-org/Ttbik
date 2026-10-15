"""
Merge proposal (2026-10-15, additive, NOT run by any workflow): weight-average the Arabic SFT checkpoint
(sham-chat-arabic-sft-checkpoint/final_chat.pt) with the chat stage's (sham-chat-checkpoint/final_chat.pt)
toward ONE final checkpoint. The engineer decides if/when to run it.

  python sham_sft_merge.py --chat A/final_chat.pt --sft B/final_chat.pt --tokenizer A/sham_small_tokenizer.json \
         --progress B/sft_progress.json --ratios 0.0,0.25,0.5,0.75,1.0 --out merged_chat.pt

ratio = weight of the SFT model (0 = chat only, 1 = SFT only). It refuses to merge when config, keys or shapes
differ (no forcing). Every ratio is scored on held-out data neither model trained on: sham_eval's fixed pairs and
the SFT notebook's frozen 2% questions. The best ratio is saved only if --out is given; nothing is published.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch

from checkpoint import load_checkpoint, save_checkpoint
from text_tokenizer import ShamTextTokenizer


def check_compatible(a: dict, b: dict) -> list[str]:
    bad = []
    if a["config"] != b["config"]:
        bad.append(f"config differs: { {k: (a['config'].get(k), b['config'].get(k)) for k in set(a['config']) | set(b['config']) if a['config'].get(k) != b['config'].get(k)} }")
    sa, sb = a["model_state_dict"], b["model_state_dict"]
    for k in set(sa) | set(sb):
        if k not in sa or k not in sb:
            bad.append(f"missing key: {k}")
        elif tuple(sa[k].shape) != tuple(sb[k].shape):
            bad.append(f"shape {k}: {tuple(sa[k].shape)} vs {tuple(sb[k].shape)}")
    return bad


def average(sa: dict, sb: dict, ratio: float) -> dict:
    out = {}
    for k, va in sa.items():
        vb = sb[k]
        out[k] = ((1 - ratio) * va.float() + ratio * vb.float()).to(va.dtype) if va.is_floating_point() else va.clone()
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--chat", required=True)
    ap.add_argument("--sft", required=True)
    ap.add_argument("--tokenizer", required=True)
    ap.add_argument("--progress", default="", help="sft_progress.json (its fixed_holdout questions)")
    ap.add_argument("--ratios", default="0.0,0.25,0.5,0.75,1.0")
    ap.add_argument("--out", default="")
    ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = ap.parse_args()

    a = torch.load(args.chat, map_location="cpu", weights_only=False)
    b = torch.load(args.sft, map_location="cpu", weights_only=False)
    bad = check_compatible(a, b)
    if bad:
        print("NOT compatible — no merge:\n" + "\n".join(bad[:40]))
        return 2
    tok = ShamTextTokenizer.load(args.tokenizer)
    model, step, _ = load_checkpoint(args.chat, map_location=args.device)

    from sham_chat import batch_examples, build_chat_example
    from sham_eval import answer_loss, fixed_eval_pairs
    from sham_merge import batches_loss
    pairs = fixed_eval_pairs()
    held = []
    if args.progress and Path(args.progress).exists():
        held = json.loads(Path(args.progress).read_text(encoding="utf-8")).get("fixed_holdout") or []
    held_b = batch_examples([build_chat_example(tok.encode(q), tok.encode(x), max_len=model.cfg.max_seq_len) for q, x in held], 8) if held else []

    results = []
    for r in [float(x) for x in args.ratios.split(",")]:
        model.load_state_dict(average(a["model_state_dict"], b["model_state_dict"], r))
        model.to(args.device)
        s = {"ratio": r, "eval_fixed": round(answer_loss(model, tok, pairs, args.device), 4),
             "sft_holdout": round(batches_loss(model, held_b, args.device), 4) if held_b else None}
        s["score"] = s["eval_fixed"] + (s["sft_holdout"] or 0.0)
        results.append(s)
        print(s)
    best = min(results, key=lambda s: s["score"])
    print("best:", best)
    if args.out:
        model.load_state_dict(average(a["model_state_dict"], b["model_state_dict"], best["ratio"]))
        save_checkpoint(args.out, model, max(int(a["step"]), int(b["step"])),
                        extra={"merge": "sft_weight_average", "ratio": best["ratio"], "results": results})
        print("saved", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
