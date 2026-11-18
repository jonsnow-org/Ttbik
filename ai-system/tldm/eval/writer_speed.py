#!/usr/bin/env python3
"""0.3B T-LDM end-to-end speed (reader + compressor + thinker + writer) under the inference options of this PR, on THIS CPU.
  taskset -c 0,1 python eval/writer_speed.py --threads 2 --json OUT      (a 2-vCPU Studio-equivalent)
  python eval/writer_speed.py --threads 8 --json OUT
Random-init weights (speed does not depend on training). A random model has no confidence, so the parallel-threshold option cannot be timed on it directly:
instead the writer is run for a FIXED number of passes = the mean passes that option actually needed on the trained held-out gate checkpoints
(eval/writer_speed_gate.py: 10 -> about 2). tok/s = block x batch / wall time of one full generate (the book's counting: every block position is a
written token; the useful command is usually ~5 tokens). Median of --reps timed runs after a warm-up."""
import argparse
import json
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import common  # noqa: E402,F401
import torch  # noqa: E402
from sham_tldm import Sham1_TLDM, cpu_has_amx, fast_inference  # noqa: E402


def med(f, reps):
    f()
    ts = []
    for _ in range(reps):
        t = time.perf_counter()
        f()
        ts.append(time.perf_counter() - t)
    return statistics.median(ts), min(ts)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--threads", type=int, default=os.cpu_count())
    ap.add_argument("--reps", type=int, default=7)
    ap.add_argument("--passes", default="10,3,2", help="writer passes to time (10 = the default schedule; 2-3 = parallel 0.7 on the gate)")
    ap.add_argument("--blocks", default="128,64")
    ap.add_argument("--modes", default="fp32,bf16,int8")
    ap.add_argument("--in-bytes", default="64", help="real input bytes per request, rest PAD (64 = a full window; the 30+12+14 gate tasks average 23-27 bytes)")
    ap.add_argument("--batches", default="1", help="requests per generate (batching: one writer pass serves every row)")
    ap.add_argument("--json", default="")
    a = ap.parse_args()
    torch.set_num_threads(a.threads)
    rows = []
    for block in [int(x) for x in a.blocks.split(",")]:
        for mode in a.modes.split(","):
            torch.manual_seed(0)
            m = Sham1_TLDM(d=1280, layers=12, latents=16, think_steps=5, block=block, writer_layers=4, heads=8, in_len=64, vocab=512).eval()
            params = m.count_params()
            fast_inference(m, mode)
            for batch, nin in [(int(b), int(n)) for b in a.batches.split(",") for n in a.in_bytes.split(",")]:
                ids = torch.randint(1, 500, (batch, 64))
                ids[:, nin:] = 0
                ids_read = ids[:, :nin]                                  # what generate(trim=True) feeds the reader
                with torch.inference_mode():                     # where one generate's time goes: reader, compressor+thinker, one writer pass
                    pad = ids_read == 0
                    h = m.read(ids_read)
                    z, _ = m.core.latents(h, pad, False)
                    w = m.core.writer
                    tk, mk = torch.zeros(batch, block, dtype=torch.long), torch.ones(batch, block, dtype=torch.bool)
                    split = {"read_ms": med(lambda: m.read(ids_read), a.reps)[0], "think_ms": med(lambda: m.core.latents(h, pad, False), a.reps)[0],
                             "writer_pass_ms": med(lambda: w.logits(tk, mk, z), a.reps)[0]}
                    split = {k: round(v * 1e3, 1) for k, v in split.items()}
                    print(json.dumps({"block": block, "mode": mode, "batch": batch, "in_bytes": nin, "threads": a.threads, **split}), flush=True)
                    for passes in [int(x) for x in a.passes.split(",")]:
                        t, tmin = med(lambda: m.generate(ids, steps=passes, end_exit=False), a.reps)
                        r = {"params_M": round(params / 1e6, 1), "block": block, "mode": mode, "passes": passes, "threads": a.threads, "batch": batch, "in_bytes": nin,
                             "ms": round(t * 1e3, 1), "tok_s": round(block * batch / t, 1), "tok_s_best": round(block * batch / tmin, 1), **split}
                        rows.append(r)
                        print(json.dumps(r), flush=True)
            del m
    flags = next((ln.split(":", 1)[1].split() for ln in open("/proc/cpuinfo") if ln.startswith("flags")), []) if os.path.exists("/proc/cpuinfo") else []
    out = {"date": time.strftime("%Y-%m-%d"), "torch": torch.__version__, "amx": cpu_has_amx(), "cpu_capability": torch.backends.cpu.get_cpu_capability(),
           "isa": [f for f in ("avx2", "avx_vnni", "avx512f", "avx512_vnni", "avx512_bf16", "amx_bf16", "amx_int8") if f in flags], "affinity_cores": len(os.sched_getaffinity(0)),
           "cpu": open("/proc/cpuinfo").read().split("model name")[1].split("\n")[0].strip(": \t") if os.path.exists("/proc/cpuinfo") else "", "rows": rows}
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(out, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
