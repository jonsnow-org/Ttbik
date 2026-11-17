#!/usr/bin/env python3
"""python training/train_0.3b.py --config configs/experiment_0.3b.yaml  ->  checkpoints/0.3b/final.pt  (trains on the 30 terminal examples, then runs them in the sandbox)"""
import argparse
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
from common import ROOT, load_config, make_tokenizer  # noqa: E402
import torch  # noqa: E402
from sham_tldm import Sham1_TLDM  # noqa: E402
import terminal_tasks as T  # noqa: E402


def build(cfg):
    return Sham1_TLDM(d=cfg["d"], layers=cfg["layers"], latents=cfg["latents"], think_steps=cfg["think_steps"], block=cfg["block"], writer_layers=cfg["writer_layers"], heads=cfg["heads"], bitnet=cfg["bitnet"], in_len=cfg["in_len"], vocab=cfg.get("vocab", 257))


def batch(rows, cfg, tok):
    ids = torch.tensor([tok.encode(t, cfg["in_len"]) for t, _ in rows])
    tgt = torch.tensor([tok.encode(c, cfg["block"]) for _, c in rows])
    return ids, tgt


def evaluate(model, rows, cfg, steps, tok):
    model.eval()
    ids, _ = batch(rows, cfg, tok)
    with torch.no_grad():
        out, _ = model.generate(ids, steps=steps)
    ok, exact, shown = 0, 0, []
    for (task, ref), row in zip(rows, out):
        cmd = tok.decode(row)
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
    a = ap.parse_args()
    cfg = load_config(a.config)
    if a.steps:
        cfg["steps"] = a.steps
    if a.bitnet:
        cfg["bitnet"] = a.bitnet.lower() == "true"
    torch.manual_seed(0)
    tok = make_tokenizer(cfg, [t for t, _ in T.TRAIN] + [c for _, c in T.TRAIN])      # trained on the TRAINING tasks only
    cfg["vocab"] = tok.vocab
    model = build(cfg)
    print(f"tokenizer: {tok.kind}, vocabulary {tok.vocab}; a command averages {sum(len([i for i in tok.encode(c, 64) if i]) for _, c in T.TRAIN)/len(T.TRAIN):.1f} tokens", flush=True)
    print(f"params: {model.count_params()/1e6:.1f}M (the name '0.3B' is the book's; this configuration really has this many)", flush=True)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg["lr"], weight_decay=0.01)
    ids, tgt = batch(T.TRAIN, cfg, tok)
    t0 = time.time()
    for step in range(cfg["steps"]):
        for g in opt.param_groups:
            g["lr"] = cfg["lr"] * min(1.0, (step + 1) / 30)
        opt.zero_grad(set_to_none=True)
        loss = model.loss(ids, tgt)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        if step % 50 == 0 or step == cfg["steps"] - 1:
            print(f"step {step} loss {loss.item():.4f} ({time.time()-t0:.0f}s)", flush=True)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    torch.save({"cfg": cfg, "model": model.state_dict(), "tokenizer": tok.state()}, a.out)
    print("saved", a.out)
    for name, rows in (("training tasks", T.TRAIN), ("held-out paraphrases", T.HELDOUT)):
        r, shown = evaluate(model, rows, cfg, cfg["diffusion_steps"], tok)
        print(f"{name}: terminal result identical to the reference command's: {r['same_effect']}  exact command text: {r['exact_text']}")
        for task, ref, cmd, good in shown:
            if not good:
                print(f"   miss: {task!r}: wrote {cmd!r}, reference {ref!r}")


if __name__ == "__main__":
    main()
