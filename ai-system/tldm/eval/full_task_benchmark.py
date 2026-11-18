#!/usr/bin/env python3
"""Spec step 4: the FULL task, not tokens/s. python eval/full_task_benchmark.py --ckpt checkpoints/loop/final.pt --json ../../docs/experiments/tldm_full_task_benchmark_2026-11-18.json

T-LDM (the agent loop): per episode, wall time from the task to the final reply = every writer call + every real command in the sandbox; success = the folder's
final state AND the reply equal the reference episode's (the same rule as train_loop.evaluate). 60 new-name episodes (seed 778), split into
simple (0-1 command) and multi-step (2 commands) tasks.

Long-explanation baseline (the book's "300 words instead of one command", §2.14): an AUTOREGRESSIVE model of Sham's own architecture (ShamSmall from
ai-system/colab/sham_small/model.py, imported read-only, KV cache on) sized to the same parameter count, writing 300 tokens greedily, timed on the same CPU.
Its weights are untrained: this measures the TIME of writing an explanation, not its quality. Its task success is 0 by construction: an explanation does
not change the folder; the user still has to do the work. The book's own numbers (9 tok/s, 33 s) are printed next to ours, not mixed with them.
"""
import argparse
import importlib.util
import json
import os
import random
import statistics
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "training"))
from common import ROOT  # noqa: E402
import torch  # noqa: E402
from sham_tldm import from_state  # noqa: E402
import trajectories as J  # noqa: E402
import terminal_tasks as T  # noqa: E402
from train_loop import build  # noqa: E402


def tldm_episode(model, cfg, tok, task, max_steps=5):
    term, hist = T.fresh(), []
    t_model = t_exec = 0.0
    try:
        for _ in range(max_steps):
            t0 = time.perf_counter()
            with torch.no_grad():
                dtask, dhist, slots = J.delex_view(task, hist, cfg.get("delex", False))
                out, _ = model.generate(torch.tensor([J.view_ids(tok, dtask, dhist, cfg["in_len"])]), steps=cfg["diffusion_steps"])
            text = J.AUG.relex(tok.decode(out[0]), slots)
            t_model += time.perf_counter() - t0
            if not text.startswith("$ "):
                return text, T.snapshot(term), t_model, t_exec, len(hist)
            t0 = time.perf_counter()
            r = term.run(text[2:].strip(), confirm=True)
            t_exec += time.perf_counter() - t0
            hist.append((text[2:].strip(), (r.out if r.ok else (r.refused or r.out)).strip().replace("\n", " ")))
        return "", T.snapshot(term), t_model, t_exec, len(hist)
    finally:
        term.close()


def sham_small(target_params):
    d = os.path.join(os.path.dirname(ROOT), "colab", "sham_small")
    spec = importlib.util.spec_from_file_location("sham_small_model_ro", os.path.join(d, "model.py"))
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, d)
    spec.loader.exec_module(mod)
    best = None
    for dm, nl in ((128, 4), (192, 4), (256, 4), (256, 6), (320, 6), (384, 6), (512, 8), (640, 8)):
        cfg = mod.ShamSmallConfig(vocab_size=8000, d_model=dm, n_layers=nl, n_heads=4, n_kv_heads=2, mlp_hidden=dm * 3, max_seq_len=512)
        m = mod.ShamSmall(cfg)
        n = sum(p.numel() for p in m.parameters())
        if best is None or abs(n - target_params) < abs(best[1] - target_params):
            best = (m, n, f"d={dm}, layers={nl}")
    return best


def explain_time(model, n_tokens=300, prompt_len=16, reps=3):
    model.eval()
    ts = []
    for _ in range(reps):
        ids = torch.randint(5, 4000, (1, prompt_len))
        t0 = time.perf_counter()
        with torch.no_grad():
            out = model(ids, use_cache=True)
            logits, past = out[0], out[2]
            nxt = logits[:, -1:].argmax(-1)
            for _ in range(n_tokens - 1):
                out = model(nxt, past_key_values=past, use_cache=True)
                logits, past = out[0], out[2]
                nxt = logits[:, -1:].argmax(-1)
        ts.append(time.perf_counter() - t0)
    return statistics.median(ts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", default=os.path.join(ROOT, "checkpoints", "loop", "final.pt"))
    ap.add_argument("--episodes", type=int, default=60)
    ap.add_argument("--seed", type=int, default=778)
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    ck = torch.load(a.ckpt, map_location="cpu")
    cfg, tok = ck["cfg"], from_state(ck.get("tokenizer", {"kind": "byte"}))
    model = build(cfg)
    model.load_state_dict(ck["model"])
    model.eval()
    n_params = model.count_params()
    rng = random.Random(a.seed)
    rows = []
    t_all = time.perf_counter()
    for _ in range(a.episodes):
        task, plan, reply_t = J.make_episode(rng, new_names=True)
        _, ref_reply, ref_snap = J.run_episode(task, plan, reply_t)
        reply, snap, tm, te, nc = tldm_episode(model, cfg, tok, task)
        rows.append({"kind": "multi_step" if len(plan) >= 2 else "simple", "ok": reply == ref_reply and snap == ref_snap, "secs": tm + te, "model_s": tm, "exec_s": te, "commands": nc})
    wall = time.perf_counter() - t_all

    def summary(rs):
        if not rs:
            return {}
        return {"n": len(rs), "success": round(sum(r["ok"] for r in rs) / len(rs), 3), "median_s_per_task": round(statistics.median(r["secs"] for r in rs), 4),
                "median_model_s": round(statistics.median(r["model_s"] for r in rs), 4), "median_exec_s": round(statistics.median(r["exec_s"] for r in rs), 4),
                "tasks_per_s": round(len(rs) / sum(r["secs"] for r in rs), 2), "correct_tasks_per_s": round(sum(r["ok"] for r in rs) / sum(r["secs"] for r in rs), 2)}
    res = {"threads": torch.get_num_threads(), "tldm": {"params_M": round(n_params / 1e6, 1), "ckpt": os.path.relpath(a.ckpt, ROOT), "all": summary(rows),
                                                          "simple": summary([r for r in rows if r["kind"] == "simple"]), "multi_step": summary([r for r in rows if r["kind"] == "multi_step"]),
                                                          "wall_s_incl_reference_runs": round(wall, 2)}}
    print("T-LDM:", json.dumps(res["tldm"], ensure_ascii=False), flush=True)
    m, n, shape = sham_small(n_params)
    secs = explain_time(m)
    res["explanation_baseline"] = {"model": f"ShamSmall (Sham's autoregressive architecture), untrained, {shape}", "params_M": round(n / 1e6, 1), "tokens": 300,
                                   "secs_per_explanation": round(secs, 3), "tokens_per_s": round(300 / secs, 1), "task_success": 0.0,
                                   "note": "time to WRITE 300 tokens only; the task is still not done (the user must run it)"}
    res["book_reference"] = {"old_explanation_s": 33, "old_tok_s": 9, "tldm_task_s": 0.54, "claimed_speedup": 61}
    med = res["tldm"]["all"]["median_s_per_task"]
    res["speedup_time_to_answer"] = round(secs / med, 1) if med else None
    print("explanation baseline:", json.dumps(res["explanation_baseline"], ensure_ascii=False))
    print(f"time to a finished task (T-LDM median) {med:.3f}s vs time to an explanation {secs:.3f}s -> {res['speedup_time_to_answer']}x; success {res['tldm']['all']['success']} vs 0")
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
