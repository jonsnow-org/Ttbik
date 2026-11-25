#!/usr/bin/env python3
"""Train and evaluate a T-LDM head on the features of a running llama.cpp server (a GGUF): the Nova route. The single-command writer head (the same recipe, rewordings, 3 seeds,
the same train / held-out / held-out-2 task sets as Sham 2) and, with --loop, the AGENT-LOOP head too (task + terminal history -> "$ command" or the reply, with argument slots; the
same loop data, recipe and full-task benchmark as Sham Pro's loop_seed heads). Prints the same numbers plus a 95% Wilson verdict per held-out set.

  llama-server -m model.gguf --embeddings --pooling none -c 512 --port 8099 -t 2 &
  python training/train_gguf_head.py --config configs/nova2.yaml --server http://127.0.0.1:8099 --tokenizer tokenizer.json --seeds 3 --json out.json
"""
import argparse
import importlib.util
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))
sys.path.insert(0, os.path.join(HERE, "..", "gate"))
sys.path.insert(0, os.path.join(HERE, ".."))
import torch  # noqa: E402
from common import load_config  # noqa: E402
import terminal_tasks as T  # noqa: E402
import rewordings as RW  # noqa: E402
from sham_tldm import encode_bytes  # noqa: E402
from sham_tldm.donor import FeatureTLDM  # noqa: E402
from sham_tldm.llama_reader import LlamaReader  # noqa: E402
from stats import verdict  # noqa: E402

_spec = importlib.util.spec_from_file_location("train_sham2", os.path.join(HERE, "train_sham2.py"))
S = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(S)


def run(cfg, reader, encode, seeds, log=print):
    n = int(cfg["in_len"])
    rows = list(T.TRAIN) + (RW.generate() if cfg.get("rewordings", False) else [])
    xs = [S.text_ids(encode, t, n) for t, _ in rows]
    ys = [encode_bytes(c, int(cfg["block"])) for _, c in rows]
    d_in = reader.probe()
    t0 = time.time()
    reader.feats(xs, n)
    log(f"llama features: {len(reader.cache)} texts, width {d_in}, {time.time() - t0:.0f}s, {reader.calls} calls, input mode {reader.mode}")
    res = {"feature_width": d_in, "texts": len(reader.cache), "read_secs": round(reader.secs, 1), "input_mode": reader.mode, "seeds": []}
    for seed in range(seeds):
        head = FeatureTLDM(**S.head_args(cfg, d_in, int(cfg["block"])))
        loss = S.train_head(head, reader, xs, ys, n, cfg, seed, log)
        r = {"seed": seed, "final_loss": round(loss, 4), "head_params_M": round(head.count_params() / 1e6, 2), "train": S.eval_head(head, reader, encode, T.TRAIN, cfg),
             "heldout": S.eval_head(head, reader, encode, T.HELDOUT, cfg), "heldout2": S.eval_head(head, reader, encode, RW.HELDOUT2, cfg)}
        log(f"seed {seed}: train {r['train']['same_effect']} heldout {r['heldout']['same_effect']} heldout2 {r['heldout2']['same_effect']}")
        res["seeds"].append(r)
        score = r["heldout"]["same_effect"] + r["heldout2"]["same_effect"]
        if score >= res.get("_best_score", -1.0):                       # keep the best seed's head to serve (the served head is the one that scored best on unseen tasks)
            res["_best_score"], res["_best_seed"] = score, seed
            res["_best_state"] = {k: v.detach().clone() for k, v in head.state_dict().items()}
    gate = float(cfg.get("gate_heldout", 0.6))
    for k, rows_k in (("heldout", T.HELDOUT), ("heldout2", RW.HELDOUT2)):
        vals = [s[k]["same_effect"] for s in res["seeds"]]
        mean = sum(vals) / len(vals)
        res[k] = {"mean": round(mean, 3), "per_seed": vals, "gate": gate, "n_tasks": len(rows_k),
                  "verdict_mean": verdict(round(mean * len(rows_k)), len(rows_k), gate),
                  "verdict_per_seed": [verdict(round(v * len(rows_k)), len(rows_k), gate) for v in vals]}
    res["train_mean"] = round(sum(s["train"]["same_effect"] for s in res["seeds"]) / len(res["seeds"]), 3)
    return res


def run_loop(cfg, reader, encode, seeds, log=print):
    """The agent-loop head on the GGUF's features: what train_sham2.main does for Sham Pro's --loop, on this reader. -> ({"loop_seed<k>": state}, per-seed benchmark)."""
    ln = int(cfg["loop_in_len"])
    lx, ly = S.loop_data(encode, cfg, int(cfg.get("loop_episodes", 500)), term_factory=T.fresh)
    t0 = time.time()
    reader.feats(lx, ln)
    log(f"loop features: {len(lx)} views in {time.time() - t0:.0f}s")
    lcfg = dict(cfg, steps=int(cfg.get("loop_steps", 900)), batch=int(cfg.get("loop_batch", 64)))
    states, rows = {}, []
    for seed in range(int(seeds)):
        head = FeatureTLDM(**S.head_args(cfg, reader.d, int(cfg["loop_block"])))
        S.train_head(head, reader, lx, ly, ln, lcfg, seed, log)
        b = S.loop_benchmark(head, reader, encode, cfg, episodes=int(cfg.get("loop_eval_episodes", 60)), term_factory=T.fresh)
        log(f"loop seed {seed}: full task {b['all']['success']} simple {b['simple']['success']} multi-step {b['multi_step']['success']}")
        rows.append({"seed": seed, **b})
        states[f"loop_seed{seed}"] = {k: v.detach().cpu() for k, v in head.state_dict().items()}
    return states, rows


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(HERE, "..", "configs", "nova2.yaml"))
    ap.add_argument("--server", default="", help="llama-server in embedding mode (reader 'server': the 35B's final layer)")
    ap.add_argument("--reader", default="server", choices=["server", "gguf-embd"], help="server = a second llama-server's final-layer features; gguf-embd = Nova's own token_embd rows read from the GGUF (no server, no forward pass: sized for the 16 GB Studio)")
    ap.add_argument("--gguf", default="", help="the GGUF file (reader gguf-embd)")
    ap.add_argument("--tokenizer", required=True, help="the donor's tokenizer.json (the GGUF's vocabulary)")
    ap.add_argument("--seeds", type=int, default=3)
    ap.add_argument("--steps", type=int, default=0)
    ap.add_argument("--json", default="")
    ap.add_argument("--meta", default="", help="JSON object stored in the head payload (the GGUF file, tokenizer repo, llama.cpp build...) so the Studio can refuse a head made for another body")
    ap.add_argument("--loop", action="store_true", help="also train the agent-loop head(s) on the GGUF features and run the full-task benchmark (Sham Pro's recipe: configs loop_* keys)")
    ap.add_argument("--loop_seeds", type=int, default=1)
    ap.add_argument("--out", default="", help="write the best seed's head as a servable payload {cfg, heads:{writer: state}, feature_width, reader} (the Studio's nova_tldm_serve loads it)")
    a = ap.parse_args(argv)
    cfg = load_config(a.config)
    if a.steps:
        cfg["steps"] = a.steps
    from tokenizers import Tokenizer
    tk = Tokenizer.from_file(a.tokenizer)
    encode = lambda text, n: (tk.encode(text).ids[:n] + [0] * n)[:n]       # noqa: E731
    if a.reader == "gguf-embd":
        from sham_tldm.gguf_embed_reader import GgufEmbedReader
        reader = GgufEmbedReader(a.gguf)
    else:
        if not a.server:
            ap.error("--server is required for reader 'server'")
        reader = LlamaReader(a.server)
    res = run(cfg, reader, encode, a.seeds)
    loop_states = {}
    if a.loop:
        loop_states, res["loop"] = run_loop(cfg, reader, encode, a.loop_seeds)
    state = res.pop("_best_state", None)
    best_seed, _ = res.pop("_best_seed", None), res.pop("_best_score", None)
    print(json.dumps({k: v for k, v in res.items() if k != "seeds"}, ensure_ascii=False, indent=1))
    if a.json:
        json.dump(res, open(a.json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if a.out and state is not None:
        torch.save({"cfg": dict(cfg), "heads": {"writer": state, **loop_states}, "feature_width": res["feature_width"], "reader": "llama-gguf" if a.reader == "server" else "gguf-token-embd", "feature_scale": getattr(reader, "scale", None), "best_seed": best_seed,
                    "loop": [{"seed": r["seed"], "full_task": r["all"]["success"], "multi_step": r["multi_step"]["success"]} for r in res.get("loop", [])],
                    "heldout": res["heldout"]["mean"], "heldout2": res["heldout2"]["mean"], "verdict": {"heldout": res["heldout"]["verdict_mean"], "heldout2": res["heldout2"]["verdict_mean"]},
                    "meta": json.loads(a.meta) if a.meta else {}}, a.out)
        print(f"saved head -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
