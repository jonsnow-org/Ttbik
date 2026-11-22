#!/usr/bin/env python3
"""Speed options must not break the success metric silently: the same trained checkpoint, held-out sets re-run under each inference option.
python eval/speed_accuracy.py --ckpt CKPT [--json OUT]"""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
from common import ROOT  # noqa: E402,F401
import torch  # noqa: E402
from sham_tldm import from_state  # noqa: E402
import terminal_tasks as T  # noqa: E402
import rewordings as RW  # noqa: E402
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "training"))
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location("train_03b", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "training", "train_0.3b.py"))
tr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tr)


def score(model, tok, cfg, rows, dtype, confident):
    """One request at a time (batch 1, as served): accuracy, mean writer passes actually run, seconds per request."""
    ok, passes, secs = 0, 0, 0.0
    with torch.inference_mode():
        for task, ref in rows:
            ids = torch.tensor([tok.encode(task, cfg["in_len"])])
            t0 = time.perf_counter()
            out, info = model.generate(ids, steps=cfg["diffusion_steps"], confident=confident)
            secs += time.perf_counter() - t0
            passes += info.get("writer_passes") or 0
            ok += T.same_effect(ref, tok.decode(out[0]))
    return round(ok / len(rows), 3), round(passes / len(rows), 2), round(secs / len(rows) * 1e3, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", required=True)
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    ck = torch.load(a.ckpt, map_location="cpu")
    cfg, tok = ck["cfg"], from_state(ck["tokenizer"])
    res = {"ckpt": os.path.basename(a.ckpt), "params_M": None, "variants": []}
    for dtype in ("fp32", "bf16"):
        for confident in (0.0, 0.9, 0.99):
            m = tr.build(cfg)
            m.load_state_dict(ck["model"])
            m.eval()
            if dtype == "bf16":
                m = m.to(torch.bfloat16)
            res["params_M"] = round(m.count_params() / 1e6, 1)
            row = {"dtype": dtype, "confident": confident}
            for key, rows in (("train", T.TRAIN), ("heldout", T.HELDOUT), ("heldout2", RW.HELDOUT2)):
                acc, passes, ms = score(m, tok, cfg, rows, dtype, confident)
                row[key] = acc
                row[f"{key}_passes"] = passes
                row[f"{key}_ms"] = ms
            res["variants"].append(row)
            print(json.dumps(row), flush=True)
    if a.json:
        json.dump(res, open(a.json, "w"), indent=1)


if __name__ == "__main__":
    main()
