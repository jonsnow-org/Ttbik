#!/usr/bin/env python3
"""python training/train_loop.py --config configs/loop.yaml  -> trains on multi-step terminal episodes, then runs NEW episodes end to end through the sandbox:
success = the folder's final state AND the reply equal the reference's. Also measures (a) the same model with the terminal's results hidden (does the feedback matter?) and (b) episodes per second."""
import argparse
import os
import random
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
from common import ROOT, load_config  # noqa: E402
import torch  # noqa: E402
from sham_tldm import Sham1_TLDM, decode_bytes  # noqa: E402
import trajectories as J  # noqa: E402
import terminal_tasks as T  # noqa: E402


def build(cfg):
    return Sham1_TLDM(d=cfg["d"], layers=cfg["layers"], latents=cfg["latents"], think_steps=cfg["think_steps"], block=cfg["block"], writer_layers=cfg["writer_layers"], heads=cfg["heads"], bitnet=cfg["bitnet"], in_len=cfg["in_len"])


def run_agent(model, cfg, task, hide=False, max_steps=5):
    """The agent loop: read -> write a block -> `$ cmd` is run by the sandbox and its result is appended -> otherwise it is the final reply."""
    term, hist = T.fresh(), []
    try:
        for _ in range(max_steps):
            seen = [(c, "" if hide else r) for c, r in hist]
            ids = torch.tensor([J.view(task, seen)])
            with torch.no_grad():
                out, _ = model.generate(ids, steps=cfg["diffusion_steps"])
            text = decode_bytes(out[0])
            if text.startswith("$ "):
                cmd = text[2:].strip()
                r = term.run(cmd, confirm=True)
                hist.append((cmd, (r.out if r.ok else (r.refused or r.out)).strip().replace("\n", " ")))
                continue
            return text, T.snapshot(term), len(hist)
        return "", T.snapshot(term), len(hist)
    finally:
        term.close()


def evaluate(model, cfg, n, seed, hide=False, new_names=False):
    rng = random.Random(seed)
    ok = state_ok = 0
    t0 = time.time()
    for _ in range(n):
        task, plan, reply_t = J.make_episode(rng, new_names)
        _, ref_reply, ref_snap = J.run_episode(task, plan, reply_t)
        reply, snap, _ = run_agent(model, cfg, task, hide)
        state_ok += snap == ref_snap
        ok += (snap == ref_snap and reply == ref_reply)
    return {"episode_success": round(ok / n, 3), "final_state_correct": round(state_ok / n, 3), "episodes_per_s": round(n / (time.time() - t0), 2)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(ROOT, "configs", "loop.yaml"))
    ap.add_argument("--out", default=os.path.join(ROOT, "checkpoints", "loop", "final.pt"))
    ap.add_argument("--steps", type=int, default=0)
    ap.add_argument("--eval", type=int, default=60)
    a = ap.parse_args()
    cfg = load_config(a.config)
    if a.steps:
        cfg["steps"] = a.steps
    torch.manual_seed(0)
    xs, ys = J.make_dataset(cfg["episodes"], seed=1)
    X, Y = torch.tensor(xs), torch.tensor(ys)
    print(f"{cfg['episodes']} episodes -> {len(xs)} training steps of the agent loop", flush=True)
    model = build(cfg)
    print(f"params: {model.count_params()/1e6:.1f}M", flush=True)
    opt = torch.optim.AdamW(model.parameters(), lr=cfg["lr"], weight_decay=0.01)
    t0 = time.time()
    for step in range(cfg["steps"]):
        for g in opt.param_groups:
            g["lr"] = cfg["lr"] * min(1.0, (step + 1) / 40)
        idx = torch.randint(0, len(X), (cfg["batch"],))
        opt.zero_grad(set_to_none=True)
        loss = model.loss(X[idx], Y[idx])
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        if step % 100 == 0 or step == cfg["steps"] - 1:
            print(f"step {step} loss {loss.item():.4f} ({time.time()-t0:.0f}s)", flush=True)
    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    torch.save({"cfg": cfg, "model": model.state_dict()}, a.out)
    model.eval()
    print("episodes (file names seen in training), results returned to the model :", evaluate(model, cfg, a.eval, seed=777), flush=True)
    print("episodes (file names NEVER seen), results returned to the model        :", evaluate(model, cfg, a.eval, seed=778, new_names=True), flush=True)
    print("episodes (seen names), results HIDDEN from the model                   :", evaluate(model, cfg, a.eval, seed=777, hide=True), flush=True)


if __name__ == "__main__":
    main()
