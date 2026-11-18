#!/usr/bin/env python3
"""Where the T-LDM writer's time goes, and how far it is from the memory-bandwidth bound of the book's equation  Throughput = K * BW / W.

  python eval/speed.py --json ../../docs/experiments/tldm_speed_2026-11-18.json            (random-init weights: speed does not depend on training)

For one block: the reader, compressor and thinker run ONCE (the thinker `think_steps` times), then only the writer runs `passes` times. So per block
  bytes moved  W_blk = bytes(reader + compressor + thinker x think_steps) + passes x bytes(writer)      (embedding tables: only the rows used, ignored)
  bound        tok/s <= K * BW / W_blk     with K = block x batch tokens written per block, BW = this box's measured memory bandwidth.
Measured tok/s = block x batch / wall time of model.generate (every block position is a written token, as the book counts; the useful command is usually
shorter, see benchmark.py's "command tokens/s"). Every number is the median of `--reps` timed runs after a warm-up, under torch.inference_mode.
"""
import argparse
import json
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
import common  # noqa: E402,F401
import torch  # noqa: E402
from sham_tldm import Sham1_TLDM  # noqa: E402

SIZES = {   # name: (d, reader layers, writer layers, heads)
    "66M (experiment_0.3b*.yaml)": (640, 8, 3, 4),
    "0.3B (truly ~0.3B params)": (1280, 12, 4, 8),
}


def bandwidth(mb=512, reps=5):
    a = torch.empty(mb * 1024 * 1024 // 4, dtype=torch.float32).fill_(1.0)
    b = torch.empty_like(a)
    b.copy_(a)
    ts = []
    for _ in range(reps):
        t = time.perf_counter()
        b.copy_(a)
        ts.append(time.perf_counter() - t)
    return 2 * a.numel() * 4 / statistics.median(ts)          # bytes read + written per second


def peak_flops(threads, dtype):
    torch.set_num_threads(threads)
    dt = torch.bfloat16 if dtype == "bf16" else torch.float32
    a, b = torch.randn(1024, 1024, dtype=dt), torch.randn(1024, 1024, dtype=dt)
    t = med(lambda: a @ b, 5)
    return 2 * 1024 ** 3 / t


def med(f, reps):
    f()
    ts = []
    for _ in range(reps):
        t = time.perf_counter()
        f()
        ts.append(time.perf_counter() - t)
    return statistics.median(ts)


def nparams(mod):
    return sum(p.numel() for p in mod.parameters())


def run(name, d, layers, wl, heads, block, passes, threads, dtype, batch, bitnet, reps, latents=16, think_steps=5, in_len=64):
    torch.set_num_threads(threads)
    torch.manual_seed(0)
    m = Sham1_TLDM(d=d, layers=layers, latents=latents, think_steps=think_steps, block=block, writer_layers=wl, heads=heads, bitnet=bitnet, in_len=in_len, vocab=512).eval()
    if dtype == "bf16":
        m = m.to(torch.bfloat16)
    ids = torch.randint(1, 500, (batch, in_len))
    bytes_per = 2 if dtype == "bf16" else 4
    w = m.core.writer
    w_writer = (nparams(w) - w.embed.weight.numel()) * bytes_per
    w_once = (nparams(m.reader) + nparams(m.core.compressor) + think_steps * nparams(m.core.thinker)) * bytes_per
    flops = 2 * batch * (nparams(m.reader) * in_len + nparams(m.core.compressor) * latents + think_steps * nparams(m.core.thinker) * latents
                         + passes * (nparams(w) - w.embed.weight.numel()) * block)
    with torch.inference_mode():
        h = m.read(ids)
        pm = ids == 0
        z, _ = m.core.latents(h, pm)
        t_read = med(lambda: m.read(ids), reps)
        t_lat = med(lambda: m.core.latents(h, pm), reps)
        t_wr = med(lambda: w.generate(z, passes), reps)
        t_all = med(lambda: m.generate(ids, passes), reps)
    return {"model": name, "params_M": round(m.count_params() / 1e6, 1), "block": block, "passes": passes, "threads": threads, "dtype": dtype, "batch": batch, "bitnet": bitnet,
            "ms": {"read": round(t_read * 1e3, 2), "compress_think": round(t_lat * 1e3, 2), "writer_all_passes": round(t_wr * 1e3, 2), "total": round(t_all * 1e3, 2)},
            "tok_s": round(block * batch / t_all, 1), "bytes_moved_per_block_MB": round((w_once + passes * w_writer) / 1e6, 1), "_bytes": w_once + passes * w_writer, "_flops": flops}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reps", type=int, default=5)
    ap.add_argument("--json", default="")
    ap.add_argument("--quick", action="store_true", help="a small grid (CI-sized)")
    a = ap.parse_args()
    torch.set_num_threads(os.cpu_count())
    bw = bandwidth()
    print(f"memory bandwidth (copy, read+write): {bw/1e9:.1f} GB/s; cores {os.cpu_count()}; torch {torch.__version__}", flush=True)
    rows, grid, peaks = [], [], {}
    for name, (d, layers, wl, heads) in SIZES.items():
        for block in (64, 128):
            for threads in sorted({os.cpu_count(), 2}, reverse=True):
                for dtype in ("fp32", "bf16"):
                    grid.append((name, d, layers, wl, heads, block, 10, threads, dtype, 1, False))
        grid.append((name, d, layers, wl, heads, 64, 10, os.cpu_count(), "fp32", 1, True))        # BitNet (ternary weights, cached at inference)
        grid.append((name, d, layers, wl, heads, 64, 10, os.cpu_count(), "fp32", 8, False))       # 8 requests in one batch
    # the book's layout on the 66M body: 1000 latents (compressor) and 20 latent steps (no early exit), block 128
    grid.append(("66M, book layout: 1000 latents, 20 think steps", 640, 8, 3, 4, 128, 10, os.cpu_count(), "fp32", 1, False, 1000, 20))
    if a.quick:
        grid = [g for g in grid if g[0].startswith("66M") and g[7] == 2][:3]
    for g in grid:
        r = run(*g[:11], reps=a.reps, **({"latents": g[11], "think_steps": g[12]} if len(g) > 11 else {}))
        r["bound_tok_s"] = round(r["block"] * r["batch"] * bw / r.pop("_bytes"), 0)
        r["share_of_bound"] = round(r["tok_s"] / r["bound_tok_s"], 3)
        pk = peaks.setdefault((r["threads"], r["dtype"]), peak_flops(r["threads"], r["dtype"]))
        r["compute_bound_tok_s"] = round(r["block"] * r["batch"] * pk / r.pop("_flops"), 0)        # same block at this box's measured 1024x1024 matmul rate
        r["share_of_compute_bound"] = round(r["tok_s"] / r["compute_bound_tok_s"], 3)
        rows.append(r)
        print(json.dumps(r, ensure_ascii=False), flush=True)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump({"bandwidth_GBps": round(bw / 1e9, 1), "cores": os.cpu_count(), "torch": torch.__version__,
                       "cpu": open("/proc/cpuinfo").read().split("model name")[1].split("\n")[0].strip(": ") if os.path.exists("/proc/cpuinfo") else "", "rows": rows}, f, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
