#!/usr/bin/env python3
"""python training/evolve.py --ckpt checkpoints/loop/final.pt  : the self-evolution loop, measured.
  1. evaluate the model on NEW episodes (names never seen);  2. let it explore (sampled commands) on fresh tasks; the sandbox judges every episode, successes/failures go to the memory files;
  3. train a small LoRA on the successes ONLY (base weights frozen) ;  4. evaluate again on the same episodes: did it get better, and how big is the adapter file?
  5. recall: the same tasks again, answered from the memory files (no model call) - the non-parametric part of the same idea."""
import argparse
import os
import random
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "memory"))
from common import ROOT  # noqa: E402
import torch  # noqa: E402
from sham_tldm import Sham1_TLDM, from_state  # noqa: E402
import trajectories as J  # noqa: E402
import terminal_tasks as T  # noqa: E402
from self_evolution import MemoryStore, attach_lora, save_adapter  # noqa: E402
from train_loop import build, run_agent, evaluate  # noqa: E402


def explore(model, cfg, tok, store, n, seed, temperature):
    """Runs sampled episodes on fresh tasks; -> training pairs from the successful ones."""
    rng = random.Random(seed)
    pairs, wins = [], 0
    for _ in range(n):
        task, plan, reply_t = J.make_episode(rng, new_names=rng.random() < 0.5)
        _, ref_reply, ref_snap = J.run_episode(task, plan, reply_t)
        term, hist = T.fresh(), []
        t0 = time.time()
        try:
            reply, steps = "", []
            for _ in range(5):
                v, slots = J.step_view(tok, task, hist, cfg)
                with torch.no_grad():
                    out, _ = model.generate(torch.tensor([v]), steps=cfg["diffusion_steps"], temperature=temperature)
                raw = tok.decode(out[0])
                text = J.AUG.relex(raw, slots)
                if text.startswith("$ "):
                    cmd = text[2:].strip()
                    r = term.run(cmd, confirm=True)
                    steps.append((v, raw))
                    hist.append((cmd, (r.out if r.ok else (r.refused or r.out)).strip().replace("\n", " ")))
                else:
                    steps.append((v, raw)); reply = text
                    break
            good = reply == ref_reply and T.snapshot(term) == ref_snap
        finally:
            term.close()
        store.save(task, hist, reply, good, time.time() - t0)
        if good:
            wins += 1
            pairs += [(v, tok.encode(t, cfg["block"])) for v, t in steps]
    return pairs, wins


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=os.path.join(ROOT, "checkpoints", "loop", "final.pt"))
    ap.add_argument("--memory", default=os.path.join(ROOT, "checkpoints", "evo_memory"))
    ap.add_argument("--adapter", default=os.path.join(ROOT, "checkpoints", "loop", "evolution_adapter.pt"))
    ap.add_argument("--explore", type=int, default=120)
    ap.add_argument("--lora_steps", type=int, default=150)
    ap.add_argument("--eval", type=int, default=60)
    a = ap.parse_args()
    ck = torch.load(a.ckpt, map_location="cpu")
    cfg = ck["cfg"]
    model = build(cfg)
    tok = from_state(ck.get("tokenizer", {"kind": "byte"}))
    model.load_state_dict(ck["model"])
    model.eval()
    before = evaluate(model, cfg, tok, a.eval, seed=778, new_names=True)
    print("before evolution (names never seen):", before, flush=True)
    store = MemoryStore(a.memory)
    pairs, wins = explore(model, cfg, tok, store, a.explore, seed=5, temperature=0.7)
    print(f"exploration: {wins}/{a.explore} sampled episodes judged successful by the terminal -> {len(pairs)} training steps for the LoRA", flush=True)
    if not pairs:
        print("no successes to learn from"); return
    params = attach_lora(model, rank=4)
    print(f"LoRA parameters: {sum(p.numel() for p in params)} of {sum(p.numel() for p in model.parameters())}", flush=True)
    X = torch.tensor([v for v, _ in pairs]); Y = torch.tensor([t for _, t in pairs])
    opt = torch.optim.AdamW(params, lr=2e-3)
    model.train()
    for step in range(a.lora_steps):
        idx = torch.randint(0, len(X), (min(64, len(X)),))
        opt.zero_grad(set_to_none=True)
        model.loss(X[idx], Y[idx]).backward()
        opt.step()
    model.eval()
    size = save_adapter(model, a.adapter)
    after = evaluate(model, cfg, tok, a.eval, seed=778, new_names=True)
    print("after the LoRA (same episodes)      :", after, flush=True)
    print(f"adapter file: {size/1024:.1f} KB (the base checkpoint is untouched)")
    wins2 = sum(1 for r in store.successes())
    print(f"memory: {wins2} distinct successful tasks stored as files; recall answers a repeated task with no model call")


if __name__ == "__main__":
    main()
