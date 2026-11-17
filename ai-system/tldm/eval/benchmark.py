#!/usr/bin/env python3
"""python eval/benchmark.py --model sham1_0.3b  -> tokens/sec of the writer. Two numbers, both reported:
   block tokens/s  = block size / time to write one block (what the project book's script counts)
   command tokens/s = bytes of the command that was actually needed / the same time (what the user gets)"""
import argparse
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))
from common import ROOT  # noqa: E402
import torch  # noqa: E402
from sham_tldm import Sham1_TLDM, encode_bytes, decode_bytes, bitnet_size_bytes  # noqa: E402
import terminal_tasks as T  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="sham1_0.3b")
    ap.add_argument("--ckpt", default=os.path.join(ROOT, "checkpoints", "0.3b", "final.pt"))
    ap.add_argument("--reps", type=int, default=3)
    a = ap.parse_args()
    ck = torch.load(a.ckpt, map_location="cpu")
    cfg = ck["cfg"]
    model = Sham1_TLDM(d=cfg["d"], layers=cfg["layers"], latents=cfg["latents"], think_steps=cfg["think_steps"], block=cfg["block"], writer_layers=cfg["writer_layers"], heads=cfg["heads"], bitnet=cfg["bitnet"], in_len=cfg["in_len"])
    model.load_state_dict(ck["model"])
    model.eval()
    torch.set_num_threads(max(1, torch.get_num_threads()))
    print(f"model {a.model}: {model.count_params()/1e6:.1f}M parameters, {torch.get_num_threads()} threads, block {cfg['block']}, latent steps {cfg['think_steps']}")
    rows = T.TRAIN + T.HELDOUT
    for passes in (cfg["diffusion_steps"], max(1, cfg["diffusion_steps"] // 2), 2):
        lat, useful = [], []
        for task, ref in rows:
            ids = torch.tensor([encode_bytes(task, cfg["in_len"])])
            model.generate(ids, steps=passes)                                   # warm-up
            ts = []
            for _ in range(a.reps):
                t0 = time.time()
                out, _ = model.generate(ids, steps=passes)
                ts.append(time.time() - t0)
            t = statistics.median(ts)
            lat.append(t)
            useful.append(max(len(decode_bytes(out[0]).encode("utf-8")), 1) / t)
        med = statistics.median(lat)
        print(f"writer passes {passes:2d}: latency {med*1000:7.1f} ms/command | block tokens/s {cfg['block']/med:8.0f} | command tokens/s {statistics.median(useful):8.0f}")
    size = bitnet_size_bytes(model)
    n = model.count_params()
    print(f"storage: fp16 {n*2/1e6:.1f} MB | this model's BitLinear weights packed {size['packed_bytes']/1e6:.2f} MB + other fp16 {size['other_fp16_bytes']/1e6:.1f} MB = {size['total_bytes']/1e6:.1f} MB (BitLinear layers: {size['bitlinear_weights']/1e6:.1f}M weights)")
    print("success rule of the book: >= 500 tokens/s on a normal laptop; < 100 tokens/s = debug")


if __name__ == "__main__":
    main()
