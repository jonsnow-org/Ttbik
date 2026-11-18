#!/usr/bin/env python3
"""python training/train_0.3b.py --config configs/experiment_0.3b.yaml  ->  checkpoints/0.3b/final.pt  (trains on the 30 terminal examples, then runs them in the sandbox)"""
import argparse
import math
import os
import random
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
from common import ROOT, load_config, make_tokenizer  # noqa: E402
import torch  # noqa: E402
from sham_tldm import Sham1_TLDM  # noqa: E402
import terminal_tasks as T  # noqa: E402
import rewordings as RW  # noqa: E402
import augment as AUG  # noqa: E402


def build(cfg):
    if cfg.get("donor"):                                             # model-agnostic head on a frozen pretrained encoder (sham_tldm/donor.py)
        from sham_tldm.donor import DonorTLDM
        return DonorTLDM(os.path.expandvars(cfg["donor"]), d=cfg["d"], latents=cfg["latents"], think_steps=cfg["think_steps"], block=cfg["block"], writer_layers=cfg["writer_layers"],
                         heads=cfg["heads"], vocab=cfg.get("vocab", 257), in_len=cfg["in_len"], think_exit=cfg.get("think_exit", "change"), think_min_steps=int(cfg.get("think_min_steps", 2)))
    return Sham1_TLDM(d=cfg["d"], layers=cfg["layers"], latents=cfg["latents"], think_steps=cfg["think_steps"], block=cfg["block"], writer_layers=cfg["writer_layers"], heads=cfg["heads"], bitnet=cfg["bitnet"], in_len=cfg["in_len"], vocab=cfg.get("vocab", 257), think_exit=cfg.get("think_exit", "change"), think_min_steps=int(cfg.get("think_min_steps", 2)))


def batch(rows, cfg, tok):
    ids = [t for t, _ in rows] if cfg.get("donor") else torch.tensor([tok.encode(t, cfg["in_len"]) for t, _ in rows])
    tgt = torch.tensor([tok.encode(c, cfg["block"]) for _, c in rows])
    return ids, tgt


FILLER = ["please", "now", "can you", "quickly"]


def noisy(task: str, rng: random.Random) -> str:
    """Training-time robustness only (nothing from the held-out set is used): drop a word, add a filler word, change case. A one-word task is never emptied."""
    w = task.split()
    if len(w) > 2 and rng.random() < 0.4:
        i = rng.randrange(len(w))
        if not w[i].startswith("@"):                                 # an argument slot is never dropped
            w.pop(i)
    if rng.random() < 0.3:
        w.insert(rng.randrange(len(w) + 1), rng.choice(FILLER))
    t = " ".join(w)
    return " ".join(x if x.startswith("@") else x.lower() for x in t.split()) if rng.random() < 0.3 else t


def lr_at(step: int, total: int, peak: float, warm: int = 30, floor: float = 0.05) -> float:
    """Warm-up, then a cosine decay to floor*peak (the first run kept 1e-3 flat and its loss rose again after step 250)."""
    if step < warm:
        return peak * (step + 1) / warm
    return peak * (floor + (1 - floor) * 0.5 * (1 + math.cos(math.pi * (step - warm) / max(1, total - warm))))


def evaluate(model, rows, cfg, steps, tok):
    model.eval()
    dl = [AUG.delex(t) if cfg.get("delex") else (t, None, {}) for t, _ in rows]
    ids, _ = batch([(d[0], c) for d, (_, c) in zip(dl, rows)], cfg, tok)
    with torch.no_grad():
        out, _ = model.generate(ids, steps=steps)
    ok, exact, shown = 0, 0, []
    for (task, ref), row, d in zip(rows, out, dl):
        cmd = AUG.relex(tok.decode(row), d[2])
        exact += cmd == ref
        good = T.same_effect(ref, cmd)
        ok += good
        shown.append((task, ref, cmd, good))
    return {"same_effect": round(ok / len(rows), 3), "exact_text": round(exact / len(rows), 3)}, shown


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(ROOT, "configs", "experiment_0.3b.yaml"))
    ap.add_argument("--out", default=os.path.join(ROOT, "checkpoints", "0.3b", "final.pt"))
    ap.add_argument("--steps", type=int, default=0)
    ap.add_argument("--bitnet", default="")
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--json", default="", help="write the final numbers here")
    a = ap.parse_args()
    cfg = load_config(a.config)
    if a.steps:
        cfg["steps"] = a.steps
    if a.bitnet:
        cfg["bitnet"] = a.bitnet.lower() == "true"
    torch.manual_seed(a.seed)
    rows = list(T.TRAIN)
    if cfg.get("rewordings", False):                                 # more ways to ask for the same TRAINING commands (data/rewordings.py; held-out-safe, checked)
        extra = RW.generate(seed=a.seed, per_command=int(cfg.get("rewordings_per_command", 24)))
        assert not RW.check(extra), RW.check(extra)[:3]
        rows += extra
    if cfg.get("delex", False):                                      # arguments become @F1/@N1 slots on both sides: the writer copies them (relex() after generation)
        rows = [AUG.delex(t, c)[:2] for t, c in rows]
    print(f"training rows: {len(rows)} ({len(rows) - len(T.TRAIN)} extra)", flush=True)
    tok = make_tokenizer(cfg, [t for t, _ in rows] + [c for _, c in rows])      # trained on the TRAINING texts only
    cfg["vocab"] = tok.vocab
    model = build(cfg)
    print(f"tokenizer: {tok.kind}, vocabulary {tok.vocab}; a command averages {sum(len([i for i in tok.encode(c, 64) if i]) for _, c in T.TRAIN)/len(T.TRAIN):.1f} tokens", flush=True)
    print(f"params: {model.count_params()/1e6:.1f}M (the name '0.3B' is the book's; this configuration really has this many)", flush=True)
    # Startup self-check: a missing MiniLM tokenizer silently becomes BertTokenizer and the cycle scores at the floor (0.067/0.083/0.071). Fail now.
    if cfg.get("donor"):
        from sham_tldm.donor import check_donor_features, check_donor_tokenizer
        check_donor_tokenizer(model.dtok)
        sims = check_donor_features(model.donor, model.dtok)
        print(f"donor sanity: tokenizer ok, reader feature cosine={['%.3f' % s for s in sims]}", flush=True)
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=cfg["lr"], weight_decay=0.01)
    ids, tgt = batch(rows, cfg, tok)
    rng = random.Random(a.seed)
    bs = int(cfg.get("batch", 0))
    augment, every = bool(cfg.get("augment", False)), int(cfg.get("eval_every", 0))
    t0 = time.time()
    for step in range(cfg["steps"]):
        for g in opt.param_groups:
            g["lr"] = lr_at(step, cfg["steps"], cfg["lr"]) if cfg.get("cosine", False) else cfg["lr"] * min(1.0, (step + 1) / 30)
        if augment or (bs and bs < len(rows)):
            pick = rng.sample(rows, bs) if bs and bs < len(rows) else rows
            ids, tgt = batch([(noisy(t, rng) if augment else t, c) for t, c in pick], cfg, tok)
        opt.zero_grad(set_to_none=True)
        loss = model.loss(ids, tgt)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        if step % 50 == 0 or step == cfg["steps"] - 1:
            print(f"step {step} loss {loss.item():.4f} lr {opt.param_groups[0]['lr']:.2e} ({time.time()-t0:.0f}s)", flush=True)
        if every and (step + 1) % every == 0:
            r, _ = evaluate(model, T.TRAIN, cfg, cfg["diffusion_steps"], tok)     # logged only: nothing is selected on the held-out set
            print(f"   [train-set check @ {step+1}] same-effect {r['same_effect']} exact {r['exact_text']}", flush=True)
            model.train()
        # 2026-11-18: no mid-training floor abort. A COMPLETE MiniLM donor also scores 0.133 at step 50 (lr still warming up; reproduced on seed 11,
        # identical to the live Studio), so a step-50 check killed every healthy cycle. The startup tokenizer/feature checks above catch the real
        # cause (missing tokenizer.json), and the Studio refuses to publish a head whose held-out is <= 0.2.
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    torch.save({"cfg": cfg, "model": model.head_state() if hasattr(model, "head_state") else model.state_dict(), "tokenizer": tok.state()}, a.out)
    print("saved", a.out)
    res = {"config": os.path.basename(a.config), "seed": a.seed, "params_M": round(model.count_params() / 1e6, 1), "train_rows": len(rows), "train_secs": round(time.time() - t0)}
    for name, key, ev in (("training tasks", "train", T.TRAIN), ("held-out paraphrases", "heldout", T.HELDOUT), ("held-out set 2 (frozen 2026-11-18)", "heldout2", RW.HELDOUT2)):
        r, shown = evaluate(model, ev, cfg, cfg["diffusion_steps"], tok)
        res[key] = r
        print(f"{name}: terminal result identical to the reference command's: {r['same_effect']}  exact command text: {r['exact_text']}")
        for task, ref, cmd, good in shown:
            if not good:
                print(f"   miss: {task!r}: wrote {cmd!r}, reference {ref!r}")
    if a.json:
        import json
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
