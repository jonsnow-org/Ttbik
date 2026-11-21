#!/usr/bin/env python3
"""Writer speed options on the held-out gate: the SAME trained checkpoints, every option re-run one request at a time (batch 1, as served).
  python eval/writer_speed_gate.py --ckpt A.pt [--ckpt B.pt ...] [--json OUT]
For each option: same_effect on train / HELDOUT / HELDOUT2, mean writer passes actually run, and (end_exit) whether the decoded text is identical to the
no-early-exit baseline on every row. An option is accepted only if no held-out set loses accuracy on any checkpoint."""
import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
from common import ROOT  # noqa: E402,F401
import torch  # noqa: E402
import copy  # noqa: E402
from sham_tldm import fast_inference, from_state  # noqa: E402
import terminal_tasks as T  # noqa: E402
import rewordings as RW  # noqa: E402
import importlib.util  # noqa: E402
_spec = importlib.util.spec_from_file_location("train_03b", os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "training", "train_0.3b.py"))
tr = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(tr)

OPTIONS = {   # name: generate() keyword arguments
    "baseline (10 passes)": dict(end_exit=False),
    "end_exit (lossless)": dict(end_exit=True),
    "end_exit + parallel 0.9": dict(end_exit=True, parallel=0.9),
    "end_exit + parallel 0.7": dict(end_exit=True, parallel=0.7),
    "end_exit + parallel 0.5": dict(end_exit=True, parallel=0.5),
    "end_exit + confident 0.9": dict(end_exit=True, confident=0.9),
    "bf16 head": dict(end_exit=False, fast="bf16"),
    "int8 head": dict(end_exit=False, fast="int8"),
    "bf16 head + end_exit + parallel 0.7": dict(end_exit=True, parallel=0.7, fast="bf16"),
    "int8 head + end_exit + parallel 0.7": dict(end_exit=True, parallel=0.7, fast="int8"),
}
SETS = (("train", T.TRAIN), ("heldout", T.HELDOUT), ("heldout2", RW.HELDOUT2))


def run(model, tok, cfg, rows, kw):
    texts, passes, secs = [], 0, 0.0
    with torch.inference_mode():
        for task, _ in rows:
            ids = [task] if cfg.get("donor") else torch.tensor([tok.encode(task, cfg["in_len"])])
            t0 = time.perf_counter()
            out, info = model.generate(ids, steps=cfg["diffusion_steps"], **kw)
            secs += time.perf_counter() - t0
            passes += info.get("writer_passes") or 0
            texts.append(tok.decode(out[0]))
    acc = sum(T.same_effect(ref, t) for (_, ref), t in zip(rows, texts)) / len(rows)
    return texts, round(acc, 3), round(passes / len(rows), 2), round(secs / len(rows) * 1e3, 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", action="append", required=True)
    ap.add_argument("--json", default="")
    ap.add_argument("--only", default="", help="comma list of option-name substrings to run (the baseline always runs)")
    a = ap.parse_args()
    if a.only:
        keep = [k for k in OPTIONS if k.startswith("baseline") or any(x.strip() in k for x in a.only.split(","))]
        for k in list(OPTIONS):
            if k not in keep:
                OPTIONS.pop(k)
    res = {"date": time.strftime("%Y-%m-%d"), "threads": torch.get_num_threads(), "ckpts": [], "options": {}}
    for path in a.ckpt:
        ck = torch.load(path, map_location="cpu")
        cfg, tok = ck["cfg"], from_state(ck["tokenizer"])
        m = tr.build(cfg)
        m.load_state_dict(ck["model"], strict=not cfg.get("donor"))
        m.eval()
        res["ckpts"].append(os.path.basename(path))
        base = {}
        for name, kw in OPTIONS.items():
            row = res["options"].setdefault(name, {"kwargs": kw, "per_ckpt": []})
            kw = dict(kw)
            mode = kw.pop("fast", None)
            mm = m
            if mode:
                mm = copy.copy(m)                                                                   # the donor encoder is shared, only our head is converted
                mm._modules = dict(m._modules)
                for part in ("proj", "core"):
                    if hasattr(m, part):
                        setattr(mm, part, copy.deepcopy(getattr(m, part)))
                if not hasattr(m, "proj"):
                    mm = copy.deepcopy(m)
                fast_inference(mm, mode)
            r = {}
            for key, rows in SETS:
                run(mm, tok, cfg, rows[:2], kw)                                                  # warm-up
                texts, acc, passes, ms = run(mm, tok, cfg, rows, kw)
                if name.startswith("baseline"):
                    base[key] = texts
                r[key] = acc
                r[f"{key}_passes"] = passes
                r[f"{key}_ms"] = ms
                r[f"{key}_same_text_as_baseline"] = texts == base[key]
            row["per_ckpt"].append(r)
            print(os.path.basename(path), name, json.dumps(r), flush=True)
    for name, row in res["options"].items():
        pc = row["per_ckpt"]
        row["mean"] = {k: round(sum(r[k] for r in pc) / len(pc), 3) for k in pc[0] if not k.endswith("baseline")}
        row["identical_text_everywhere"] = all(r[f"{k}_same_text_as_baseline"] for r in pc for k, _ in SETS)
        b = res["options"]["baseline (10 passes)"]["per_ckpt"]
        row["no_heldout_regression"] = all(r[k] >= q[k] for r, q in zip(pc, b) for k in ("heldout", "heldout2"))
    print(json.dumps({n: {**r["mean"], "identical": r["identical_text_everywhere"], "no_regression": r["no_heldout_regression"]} for n, r in res["options"].items()}, indent=1))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(res, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
