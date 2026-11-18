#!/usr/bin/env python3
"""Spec step 3 (TLDM_TERMINAL_SPEC §3): a LoRA, measured on tasks the model FAILED before.

  python training/lora_failed.py --ckpt checkpoints/loop/final.pt --json ../../docs/experiments/tldm_lora_failed_2026-11-18.json

  1. FAILED POOL: new-name episodes (file names never seen in training) are run end to end; the ones the base model fails are kept, split by file name:
       A = names {summary, answer, number}: the tasks the LoRA may learn from;   B = names {tally, size}: failed tasks of the same kinds the LoRA never sees.
     Plus C = episodes the base model already got right (does the LoRA break them?).
  2. SELF-EVOLUTION ARM (the book's §7): for every failed task in A, retry with sampling (temperature) up to K times; the verifier (here the reference episode,
     in serving a check that knows the task) judges each try. Only verified successes become LoRA training pairs. Base weights frozen; the delta is a separate file.
  3. REFERENCE ARMS (upper bound, NOT self-evolution): the same LoRA trained on the reference episodes of A (what a teacher/owner correction would give),
     alone and mixed with replay of the original training episodes (against forgetting).
  4. Measured after each arm, greedy decoding: A again (the previously failed tasks themselves), B (failed kinds, unseen names), C (forgetting), and the
     standard 60-episode new-name evaluation (seed 778) used everywhere else.
"""
import argparse
import json
import os
import random
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "memory"))
from common import ROOT  # noqa: E402
import torch  # noqa: E402
from sham_tldm import from_state  # noqa: E402
import trajectories as J  # noqa: E402
import terminal_tasks as T  # noqa: E402
from self_evolution import attach_lora, save_adapter  # noqa: E402
from train_loop import build, evaluate  # noqa: E402

A_NAMES, B_NAMES = {"summary.txt", "answer.txt", "number.txt"}, {"tally.txt", "size.txt"}


def play(model, cfg, tok, task, temperature=0.0, max_steps=5):
    """-> (reply, snapshot, [(view_ids, target_text)]) for one episode on a fresh sandbox."""
    term, hist, steps = T.fresh(), [], []
    try:
        for _ in range(max_steps):
            v, slots = J.step_view(tok, task, hist, cfg)
            with torch.no_grad():
                out, _ = model.generate(torch.tensor([v]), steps=cfg["diffusion_steps"], temperature=temperature)
            raw = tok.decode(out[0])
            text = J.AUG.relex(raw, slots)
            steps.append((v, raw))
            if not text.startswith("$ "):
                return text, T.snapshot(term), steps
            r = term.run(text[2:].strip(), confirm=True)
            hist.append((text[2:].strip(), (r.out if r.ok else (r.refused or r.out)).strip().replace("\n", " ")))
        return "", T.snapshot(term), steps
    finally:
        term.close()


def pools(model, cfg, tok, n, seed):
    rng = random.Random(seed)
    A, B, C, seen = [], [], [], set()
    for _ in range(n):
        task, plan, reply_t = J.make_episode(rng, new_names=True)
        if task in seen:
            continue
        seen.add(task)
        ref_steps, ref_reply, ref_snap = J.run_episode(task, plan, reply_t)
        reply, snap, _ = play(model, cfg, tok, task)
        ep = {"task": task, "ref_reply": ref_reply, "ref_snap": ref_snap, "ref_steps": ref_steps}
        if reply == ref_reply and snap == ref_snap:
            C.append(ep)
        else:
            name = next((w for w in task.replace("?", " ").split() if w.endswith(".txt") and w != "names.txt"), "")
            (A if name in A_NAMES else B if name in B_NAMES else A).append(ep)
    return A, B, C


def score(model, cfg, tok, eps):
    ok = 0
    for e in eps:
        reply, snap, _ = play(model, cfg, tok, e["task"])
        ok += reply == e["ref_reply"] and snap == e["ref_snap"]
    return {"solved": ok, "of": len(eps), "rate": round(ok / max(1, len(eps)), 3)}


def train_lora(model, pairs, steps, rank, seed):
    torch.manual_seed(seed)
    params = attach_lora(model, rank=rank)
    X = torch.tensor([v for v, _ in pairs])
    Y = torch.tensor([t for _, t in pairs])
    opt = torch.optim.AdamW(params, lr=2e-3)
    model.train()
    for _ in range(steps):
        idx = torch.randint(0, len(X), (min(64, len(X)),))
        opt.zero_grad(set_to_none=True)
        model.loss(X[idx], Y[idx]).backward()
        opt.step()
    model.eval()
    return sum(p.numel() for p in params)


def fresh_model(ck):
    cfg = ck["cfg"]
    m = build(cfg)
    m.load_state_dict(ck["model"])
    m.eval()
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=os.path.join(ROOT, "checkpoints", "loop", "final.pt"))
    ap.add_argument("--pool", type=int, default=300)
    ap.add_argument("--tries", type=int, default=8)
    ap.add_argument("--temperature", type=float, default=0.8)
    ap.add_argument("--lora_steps", type=int, default=200)
    ap.add_argument("--rank", type=int, default=4)
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--replay", type=int, default=150, help="original training episodes mixed into the LoRA data (against forgetting)")
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    t0 = time.time()
    ck = torch.load(a.ckpt, map_location="cpu")
    cfg, tok = ck["cfg"], from_state(ck.get("tokenizer", {"kind": "byte"}))
    torch.manual_seed(a.seed)
    base = fresh_model(ck)
    A, B, C = pools(base, cfg, tok, a.pool, seed=a.seed)
    print(f"pool: {len(A)} failed (A, LoRA may learn), {len(B)} failed (B, never shown), {len(C)} already right (C)", flush=True)
    res = {"ckpt": os.path.relpath(a.ckpt, ROOT), "args": vars(a) | {"ckpt": None, "json": None}, "pool": {"A_failed": len(A), "B_failed": len(B), "C_right": len(C)},
           "failed_task_examples": sorted({e["task"] for e in A + B})[:12]}
    res["before"] = {"A": score(base, cfg, tok, A), "B": score(base, cfg, tok, B), "C": score(base, cfg, tok, C), "eval60_778": evaluate(base, cfg, tok, 60, seed=778, new_names=True)}
    print("before:", res["before"], flush=True)

    # self-evolution arm: sampled retries, verified by the reference; only verified successes are learned
    rng_t = 0
    pairs, fixed = [], 0
    for e in A:
        for k in range(a.tries):
            torch.manual_seed(a.seed * 1000 + rng_t)
            rng_t += 1
            reply, snap, steps = play(base, cfg, tok, e["task"], temperature=a.temperature)
            if reply == e["ref_reply"] and snap == e["ref_snap"]:
                fixed += 1
                pairs += [(v, tok.encode(t, cfg["block"])) for v, t in steps]
                break
    res["self_evolution"] = {"retries_verified_success": fixed, "of_failed": len(A), "training_pairs": len(pairs)}
    print("self-evolution: verified successes among retries:", res["self_evolution"], flush=True)
    if pairs:
        m = fresh_model(ck)
        n_lora = train_lora(m, pairs, a.lora_steps, a.rank, a.seed)
        size = save_adapter(m, "/tmp/tldm_lora_failed_self.pt")
        res["self_evolution"] |= {"lora_params": n_lora, "adapter_kb": round(size / 1024, 1),
                                  "after": {"A": score(m, cfg, tok, A), "B": score(m, cfg, tok, B), "C": score(m, cfg, tok, C), "eval60_778": evaluate(m, cfg, tok, 60, seed=778, new_names=True)}}
        print("after self-evolution LoRA:", res["self_evolution"]["after"], flush=True)

    # reference arms (upper bound, NOT self-evolution): the reference episodes of A, alone, then mixed with replay of the ORIGINAL training episodes
    ref_pairs = [(J.step_view(tok, e["task"], h, cfg)[0], tok.encode(J.AUG.apply_slots(t, J.delex_view(e["task"], [], cfg.get("delex", False))[2]), cfg["block"]))
                 for e in A for h, t in e["ref_steps"]]
    xs, ys = J.make_dataset(a.replay, 1, tok, cfg["in_len"], cfg["block"], delex=cfg.get("delex", False))          # the training distribution (seed 1, training file names): against forgetting
    replay = list(zip(xs, ys))
    for arm, data in (("reference_corrections", ref_pairs), ("reference_corrections_plus_replay", ref_pairs * max(1, len(replay) // max(1, len(ref_pairs))) + replay)):
        if not ref_pairs:
            break
        m = fresh_model(ck)
        train_lora(m, data, a.lora_steps, a.rank, a.seed)
        res[arm] = {"training_pairs": len(data), "after": {"A": score(m, cfg, tok, A), "B": score(m, cfg, tok, B), "C": score(m, cfg, tok, C),
                                                              "eval60_778": evaluate(m, cfg, tok, 60, seed=778, new_names=True)}}
        print(f"after {arm} LoRA:", res[arm]["after"], flush=True)
    res["secs"] = round(time.time() - t0)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
