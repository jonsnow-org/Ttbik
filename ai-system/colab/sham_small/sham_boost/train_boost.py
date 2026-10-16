"""Train the sham_boost add-ons on CPU.

Stage A (default): Sham's own weights are frozen; only add-ons learn.
Stage B (--unfreeze): everything learns, Sham's weights at lr * --base-lr-scale.
Output: boost_state.pt (+ wsd state, + optional base weights for stage B as a
separate file). Never writes final_merged.pt, never touches other files.

Example:
  python -m sham_boost.train_boost --ckpt /kaggle/working/final_merged.pt \
      --tokenizer /kaggle/working/tokenizer.json \
      --text-dir /kaggle/input/... --out /kaggle/working/boost --steps 2000
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import torch

_HERE = Path(__file__).resolve().parent
if str(_HERE.parent) not in sys.path:
    sys.path.insert(0, str(_HERE.parent))

from sham_boost.boosted import BoostedSham, BoostConfig  # noqa: E402
from sham_boost.sched import WSDConfig, WSDSchedule  # noqa: E402
from sham_boost.data_stream import (  # noqa: E402
    OffsetStore, fresh_docs, pack_documents, block_causal_mask, AnnealMixer, batches, DOCS_PER_SESSION,
)
from sham_boost.modules import ShortLongContext  # noqa: E402


def _iter_text_files(d: Path):
    for p in sorted(d.rglob("*")):
        if p.suffix in (".txt", ".md"):
            yield p.read_text(errors="ignore")
        elif p.suffix == ".jsonl":
            for line in p.open(errors="ignore"):
                try:
                    r = json.loads(line)
                except Exception:
                    continue
                t = r.get("text") if isinstance(r, dict) else None
                if t:
                    yield t


def _load_encoder(tokenizer_path: str):
    from text_tokenizer import ShamTextTokenizer
    p = Path(tokenizer_path)
    return ShamTextTokenizer.load(p / "tokenizer.json" if p.is_dir() else p)


def train_steps(model: BoostedSham, data, steps: int, sched: WSDSchedule, opt, ctx: ShortLongContext | None = None,
                z_weight: float = 1e-4, use_doc_mask: bool = True, log_every: int = 20, clip: float = 1.0):
    model.train()
    hist = []
    t0 = time.time()
    for s, (ids, lab, doc) in zip(range(steps), data):
        if ctx is not None:
            T = ctx.seq_len(sched.global_step, model.base.cfg.max_seq_len)
            ids, lab, doc = ids[:, :T], lab[:, :T], doc[:, :T]
        mask = block_causal_mask(doc) if use_doc_mask else None
        _, loss = model(ids, labels=lab, doc_mask=mask, z_weight=z_weight)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_([p for g in opt.param_groups for p in g["params"]], clip)
        opt.step()
        sched.step()
        hist.append(float(loss.detach()))
        if log_every and (s + 1) % log_every == 0:
            print(f"step {sched.global_step} loss {sum(hist[-log_every:]) / log_every:.4f} "
                  f"lr {sched.lr():.2e} {time.time() - t0:.0f}s", flush=True)
    return hist


def build_optimizer(model: BoostedSham, lr: float, unfreeze: bool, base_lr_scale: float, wd: float = 0.05):
    for p in model.base.parameters():
        p.requires_grad_(unfreeze)
    groups = [{"params": model.boost_parameters(), "lr": lr, "lr_scale": 1.0, "weight_decay": 0.0}]
    if unfreeze:
        groups.append({"params": [p for p in model.base.parameters()], "lr": lr * base_lr_scale,
                       "lr_scale": base_lr_scale, "weight_decay": wd})
    return torch.optim.AdamW(groups, betas=(0.9, 0.95))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--boost-state", default=None)
    ap.add_argument("--text-dir", required=True)
    ap.add_argument("--hq-dir", default=None, help="clean text used in the decay tail")
    ap.add_argument("--tokenizer", required=True, help="Sham text tokenizer.json (or its folder)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--steps", type=int, default=1000)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--seq", type=int, default=512)
    ap.add_argument("--lr", type=float, default=1e-3)
    ap.add_argument("--warmup", type=int, default=50)
    ap.add_argument("--unfreeze", action="store_true", help="stage B")
    ap.add_argument("--base-lr-scale", type=float, default=0.1)
    ap.add_argument("--docs", type=int, default=DOCS_PER_SESSION)
    ap.add_argument("--memory-layers", default="")
    ap.add_argument("--rare-ids", default="", help="file with one token id per line")
    ap.add_argument("--threads", type=int, default=0)
    a = ap.parse_args(argv)
    if a.threads:
        torch.set_num_threads(a.threads)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)

    bcfg = None
    if not a.boost_state:
        rare = [int(x) for x in Path(a.rare_ids).read_text().split()] if a.rare_ids else []
        bcfg = BoostConfig(embed_adapter_ids=rare,
                           memory_layers=[int(x) for x in a.memory_layers.split(",") if x.strip()])
    model = BoostedSham.from_checkpoint(a.ckpt, a.boost_state, bcfg)
    enc = _load_encoder(a.tokenizer).encode

    store = OffsetStore(out / "offsets.json")
    docs = fresh_docs("bulk", _iter_text_files(Path(a.text_dir)), store, a.docs)
    rows = pack_documents((enc(d) for d in docs), a.seq)
    hq_rows = []
    if a.hq_dir:
        hq_rows = list(pack_documents((enc(d) for d in _iter_text_files(Path(a.hq_dir))), a.seq))[:5000]

    opt = build_optimizer(model, a.lr, a.unfreeze, a.base_lr_scale)
    sstate = out / "wsd_state.json"
    if sstate.exists():
        sched = WSDSchedule.from_state(opt, json.loads(sstate.read_text()))
    else:
        sched = WSDSchedule(opt, WSDConfig(peak_lr=a.lr, warmup=a.warmup), start_global=model.step, session_steps=a.steps)
    data = batches(AnnealMixer(rows, hq_rows, sched.in_tail), a.batch)
    hist = train_steps(model, data, a.steps, sched, opt)

    model.save_boost(out / "boost_state.pt", {"stage": "B" if a.unfreeze else "A", "steps": len(hist),
                                              "last_loss": hist[-1] if hist else None})
    sstate.write_text(json.dumps(sched.state_dict()))
    if a.unfreeze:
        torch.save({"config": model.base.cfg.to_dict(), "step": sched.global_step,
                    "model_state_dict": model.base.state_dict()}, out / "stageB_base.pt")
    print("gates:", {k: round(v, 4) for k, v in model.gates().items() if abs(v) > 0})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
