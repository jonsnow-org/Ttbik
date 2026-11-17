#!/usr/bin/env python3
"""python training/memory_eval.py --ckpt checkpoints/loop/final.pt  : the long-term file memory (serve_adapter.TLDMChat + memory/store.py), measured on the SAME
NEW episodes (file names never seen in training, seed 778 as in training/evolve.py) three times, end to end through the sandbox:
  pass 0  memory OFF (the serving path as it was; must equal train_loop.evaluate on the same episodes: the served input is built like the training input)
  pass 1  memory ON, starting empty (repeated tasks inside the pass can already be recalled)
  pass 2  memory ON again, after pass 1 (every task seen once)
Per pass: episode success (final folder state AND reply equal the reference), model calls, recalls, recalls that returned a WRONG answer, lessons applied, episodes/s.
Success for the memory itself = a reply was reached and every command exited 0 (the terminal's verdict; there is no reference at serving time), so a wrong-but-clean
episode can be remembered: `recall_wrong` counts exactly that, it is not hidden."""
import argparse
import json
import os
import random
import shutil
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
sys.path.insert(0, os.path.join(HERE, ".."))
from common import ROOT  # noqa: E402
import serve_adapter  # noqa: E402
import trajectories as J  # noqa: E402
import terminal_tasks as T  # noqa: E402


def episodes(n, seed):
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        task, plan, reply_t = J.make_episode(rng, new_names=True)
        _, ref_reply, ref_snap = J.run_episode(task, plan, reply_t)
        out.append((task, ref_reply, ref_snap))
    return out


def run_pass(writer, eps, memory_root):
    last = {}

    def backend(_session):
        last["t"] = T.fresh()
        return last["t"]
    factory = (lambda s: serve_adapter.memory_for(memory_root, "sham_tldm_eval", s)) if memory_root else None
    chat = serve_adapter.TLDMChat(writer, backend, confirm=lambda c: True, memory_factory=factory)
    m = {"episode_success": 0, "final_state_correct": 0, "model_calls": 0, "recalls": 0, "recall_wrong": 0, "partial_recalls": 0, "lessons": 0}
    t0 = time.time()
    for task, ref_reply, ref_snap in eps:
        reply, _ = chat.respond("eval", task)
        snap = T.snapshot(last["t"])
        last["t"].close()
        good = snap == ref_snap and reply == ref_reply
        info = chat.last_info
        m["episode_success"] += good
        m["final_state_correct"] += snap == ref_snap
        m["model_calls"] += info["writer_calls"]
        m["recalls"] += info["mode"] == "recall"
        m["recall_wrong"] += info["mode"] == "recall" and not good
        m["partial_recalls"] += info["mode"] == "recall+model"
        m["lessons"] += info["lessons"]
    n = len(eps)
    m["episode_success"] = round(m["episode_success"] / n, 3)
    m["final_state_correct"] = round(m["final_state_correct"] / n, 3)
    m["episodes_per_s"] = round(n / (time.time() - t0), 2)
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=os.path.join(ROOT, "checkpoints", "loop", "final.pt"))
    ap.add_argument("--eval", type=int, default=60)
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    writer = serve_adapter.load_writer(a.ckpt)
    eps = episodes(a.eval, seed=778)
    distinct = len({" ".join(t.lower().split()) for t, _, _ in eps})
    print(f"{len(eps)} episodes, {distinct} distinct task texts (names never seen in training)", flush=True)
    root = tempfile.mkdtemp(prefix="tldm_memory_eval_")
    try:
        res = {"pass0_memory_off": run_pass(writer, eps, None)}
        print("pass 0, memory OFF            :", res["pass0_memory_off"], flush=True)
        res["pass1_memory_on_empty"] = run_pass(writer, eps, root)
        print("pass 1, memory ON (from empty):", res["pass1_memory_on_empty"], flush=True)
        res["pass2_memory_on_after_pass1"] = run_pass(writer, eps, root)
        print("pass 2, memory ON (after 1)   :", res["pass2_memory_on_after_pass1"], flush=True)
    finally:
        shutil.rmtree(root, ignore_errors=True)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump({"episodes": len(eps), "distinct_tasks": distinct, **res}, f, indent=1)


if __name__ == "__main__":
    main()
