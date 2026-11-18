#!/usr/bin/env python3
"""Self-evolution on the AGENT LOOP (multi-step episodes) and the full-task benchmark (2026-11-18).

  python eval/self_evolution_loop_benchmark.py --ckpt checkpoints/loop/final.pt --seed 0 --json out.json

Users send multi-step tasks in their own messy wording (fillers, dropped words, word order, typos) with file names DISJOINT from the benchmark's held-out
names. The agent runs every episode in the sandbox; the verifier is the episode's real outcome (final folder state AND reply equal the intent's reference).
Failures -> best-of-n episode resampling (temperature ladder, variants of the task), every candidate episode really executed -> verified step pairs ->
an "agent" LoRA (base frozen) trained on them + replay of the original training episodes -> gate (no net loss on previously-correct training-name episodes
and on a dev set; gain on the failed tasks) -> accept / reject. Reported per round:
  bench_clean  : the full-task benchmark exactly as in eval/full_task_benchmark.py (60 new-name episodes, seed 778; simple / multi-step split);
  bench_messy  : the same 60 episodes with users' messy wording (fixed seed, never trained on, never used by the gate);
  prev_correct : training-name episodes the base model solved (forgetting)."""
import argparse
import json
import os
import random
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [os.path.join(HERE, "..", "scripts"), os.path.join(HERE, "..", "evolution"), os.path.join(HERE, "..", "training")]
from common import ROOT  # noqa: E402,F401
import torch  # noqa: E402
from sham_tldm import from_state  # noqa: E402
import terminal_tasks as T  # noqa: E402
import trajectories as J  # noqa: E402
import adapters as AD  # noqa: E402
import curriculum as CU  # noqa: E402
from train_loop import build  # noqa: E402

USER_FILES = [n + ".txt" for n in ("notes2", "log_count", "tmp_total", "my_result", "files_n", "errs")]     # disjoint from J.NEW_FILES (benchmark) and J.OUT_FILES


def episode(model, cfg, tok, task, temperature=0.0, max_steps=5):
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


def make(rng, names):
    J.NEW_FILES_SAVE = J.NEW_FILES
    J.NEW_FILES = names
    try:
        task, plan, reply_t = J.make_episode(rng, new_names=True)
    finally:
        J.NEW_FILES = J.NEW_FILES_SAVE
    _, ref_reply, ref_snap = J.run_episode(task, plan, reply_t)
    return {"task": task, "ref": (ref_reply, ref_snap), "multi": len(plan) >= 2}


def messy(task, rng):
    for _ in range(2):
        if rng.random() < 0.7:
            v = CU.variants(task, rng, 1)
            task = v[0] if v else task
    return task


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--per-round", type=int, default=120)
    ap.add_argument("--steps", type=int, default=150)
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    t0 = time.time()
    ck = torch.load(a.ckpt, map_location="cpu")
    cfg, tok = ck["cfg"], from_state(ck.get("tokenizer", {"kind": "byte"}))
    model = build(cfg)
    model.load_state_dict(ck["model"])
    model.eval()
    AD.wrap(model)
    torch.manual_seed(a.seed)

    rng = random.Random(778)
    bench = []
    for _ in range(60):                                              # exactly eval/full_task_benchmark.py's episodes
        task, plan, reply_t = J.make_episode(rng, True)
        _, rr, rs = J.run_episode(task, plan, reply_t)
        bench.append({"task": task, "ref": (rr, rs), "multi": len(plan) >= 2})
    mrng = random.Random(4242)
    bench_messy = [dict(e, task=messy(e["task"], mrng)) for e in bench]
    bench_keys = {e["task"] for e in bench + bench_messy}
    drng = random.Random(555)
    dev = [dict(e, task=messy(e["task"], drng)) for e in (make(drng, USER_FILES) for _ in range(60))]
    prng = random.Random(777)
    prev = []
    for _ in range(80):
        task, plan, reply_t = J.make_episode(prng, False)
        _, rr, rs = J.run_episode(task, plan, reply_t)
        prev.append({"task": task, "ref": (rr, rs), "multi": len(plan) >= 2})
    xs, ys = J.make_dataset(200, 1, tok, cfg["in_len"], cfg["block"], delex=cfg.get("delex", False))   # replay: the original training distribution
    replay = list(zip(xs, ys))

    def solved(eps, adapter):
        AD.set_active(model, adapter)
        out = {}
        for i, e in enumerate(eps):
            reply, snap, _ = episode(model, cfg, tok, e["task"])
            out[i] = (reply, snap) == e["ref"]
        AD.set_active(model, None)
        return out

    def report(adapter):
        bc, bm = solved(bench, adapter), solved(bench_messy, adapter)
        split = lambda d, eps, m: round(sum(v for i, v in d.items() if eps[i]["multi"] == m) / max(1, sum(1 for e in eps if e["multi"] == m)), 3)  # noqa: E731
        return {"bench_clean": round(sum(bc.values()) / 60, 3), "bench_clean_simple": split(bc, bench, False), "bench_clean_multi": split(bc, bench, True),
                "bench_messy": round(sum(bm.values()) / 60, 3), "bench_messy_simple": split(bm, bench_messy, False), "bench_messy_multi": split(bm, bench_messy, True),
                "prev_correct": round(sum(solved(prev, adapter).values()) / len(prev), 3), "dev": round(sum(solved(dev, adapter).values()) / len(dev), 3)}

    active = None
    curve = [dict(report(None), round=0)]
    print("round 0", curve[-1], flush=True)
    log = []
    srng = random.Random(9000 + a.seed)
    learned = []
    for r in range(1, a.rounds + 1):
        reqs = []
        while len(reqs) < a.per_round:
            e = make(srng, USER_FILES)
            e["task"] = messy(e["task"], srng)
            if e["task"] not in bench_keys:
                reqs.append(e)
        res = solved(reqs, active)
        fails = [reqs[i] for i, ok in res.items() if not ok]
        pairs, repaired = [], 0
        for k, e in enumerate(fails):                                # best-of-n repair, every candidate episode really executed
            texts = [e["task"]] + CU.variants(e["task"], srng, 3)
            done = False
            AD.set_active(model, active)
            for t in texts:
                for temp in (0.3, 0.6, 1.0):
                    for n in range(4):
                        torch.manual_seed(a.seed * 100003 + r * 1009 + k * 31 + n)
                        reply, snap, steps = episode(model, cfg, tok, t, temperature=temp)
                        if (reply, snap) == e["ref"]:
                            # the verified episode, re-viewed from the ORIGINAL wording (the one the user typed), plus the variant that found it
                            for tt in dict.fromkeys([e["task"], t]):
                                hist = []
                                term = T.fresh()
                                try:
                                    for v_unused, raw in steps:
                                        v, slots = J.step_view(tok, tt, hist, cfg)
                                        pairs.append((v, tok.encode(J.AUG.apply_slots(J.AUG.relex(raw, J.step_view(tok, t, hist, cfg)[1]), slots), cfg["block"])))
                                        text = J.AUG.relex(raw, J.step_view(tok, t, hist, cfg)[1])
                                        if text.startswith("$ "):
                                            rr = term.run(text[2:].strip(), confirm=True)
                                            hist.append((text[2:].strip(), (rr.out if rr.ok else (rr.refused or rr.out)).strip().replace("\n", " ")))
                                finally:
                                    term.close()
                            done = True
                            break
                    if done:
                        break
                if done:
                    break
            AD.set_active(model, None)
            repaired += done
            if done:
                learned.append(e)
        info = {"round": r, "requests": len(reqs), "online_success": round(sum(res.values()) / len(reqs), 3), "failures": len(fails), "repaired": repaired,
                "verified_step_pairs": len(pairs)}
        if pairs:
            name = f"cand{r}"
            params = AD.add_adapter(model, name, 8)
            if active:
                for m in AD.lora_modules(model):
                    m.A[name].data.copy_(m.A[active]); m.B[name].data.copy_(m.B[active])
            target = [e for e in learned]
            before = {"prev": solved(prev, active), "dev": solved(dev, active), "target": solved(target, active)}
            AD.set_active(model, name)
            opt = torch.optim.AdamW(params, lr=1e-3)
            g = torch.Generator().manual_seed(a.seed + r)
            model.train()
            for _ in range(a.steps):
                b = [pairs[i] for i in torch.randint(0, len(pairs), (16,), generator=g).tolist()] + [replay[i] for i in torch.randint(0, len(replay), (16,), generator=g).tolist()]
                opt.zero_grad(set_to_none=True)
                model.loss(torch.tensor([x for x, _ in b]), torch.tensor([y for _, y in b])).backward()
                opt.step()
            model.eval()
            after = {"prev": solved(prev, name), "dev": solved(dev, name), "target": solved(target, name)}
            ok, why = AD.gate(before, after, "target", ("prev", "dev"), {"prev": 0.02, "dev": 0.05})
            info.update(gate=ok, why=why, adapter_kb=round(AD.size_bytes(AD.adapter_state(model, name)) / 1024, 1))
            if ok:
                active = name
        log.append(info)
        curve.append(dict(report(active), round=r, online=info["online_success"]))
        print("round", r, info, curve[-1], flush=True)
    out = {"ckpt": os.path.basename(a.ckpt), "seed": a.seed, "curve": curve, "log": log, "secs": round(time.time() - t0)}
    if a.json:
        json.dump(out, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()
