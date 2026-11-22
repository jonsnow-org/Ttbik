#!/usr/bin/env python3
"""Train and evaluate a T-LDM head on the features of a running llama.cpp server (a GGUF): the Nova route. Writer head only (the same recipe, rewordings, 3 seeds, the same
train / held-out / held-out-2 task sets as Sham 2). Prints the same numbers plus a 95% Wilson verdict per held-out set.

  llama-server -m model.gguf --embeddings --pooling none -c 512 --port 8099 -t 2 &
  python training/train_gguf_head.py --config configs/nova1.yaml --server http://127.0.0.1:8099 --tokenizer tokenizer.json --seeds 3 --json out.json
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


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(HERE, "..", "configs", "nova1.yaml"))
    ap.add_argument("--server", required=True)
    ap.add_argument("--tokenizer", required=True, help="the donor's tokenizer.json (the GGUF's vocabulary)")
    ap.add_argument("--seeds", type=int, default=3)
    ap.add_argument("--steps", type=int, default=0)
    ap.add_argument("--json", default="")
    ap.add_argument("--meta", default="", help="JSON object stored in the head payload (the GGUF file, tokenizer repo, llama.cpp build...) so the Studio can refuse a head made for another body")
    ap.add_argument("--out", default="", help="write the best seed's head as a servable payload {cfg, heads:{writer: state}, feature_width, reader} (the Studio's nova_tldm_serve loads it)")
    a = ap.parse_args(argv)
    cfg = load_config(a.config)
    if a.steps:
        cfg["steps"] = a.steps
    from tokenizers import Tokenizer
    tk = Tokenizer.from_file(a.tokenizer)
    encode = lambda text, n: (tk.encode(text).ids[:n] + [0] * n)[:n]       # noqa: E731
    res = run(cfg, LlamaReader(a.server), encode, a.seeds)
    state = res.pop("_best_state", None)
    best_seed, _ = res.pop("_best_seed", None), res.pop("_best_score", None)
    print(json.dumps({k: v for k, v in res.items() if k != "seeds"}, ensure_ascii=False, indent=1))
    if a.json:
        json.dump(res, open(a.json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    if a.out and state is not None:
        torch.save({"cfg": dict(cfg), "heads": {"writer": state}, "feature_width": res["feature_width"], "reader": "llama-gguf", "best_seed": best_seed,
                    "heldout": res["heldout"]["mean"], "heldout2": res["heldout2"]["mean"], "verdict": {"heldout": res["heldout"]["verdict_mean"], "heldout2": res["heldout2"]["verdict_mean"]},
                    "meta": json.loads(a.meta) if a.meta else {}}, a.out)
        print(f"saved head -> {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
