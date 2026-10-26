"""Transplant a donor's body into Sham's class, then measure (bits per byte on our text, Sham's own tokenizer) before any training and after a short embedding-only warm-up.

  python scripts/transplant/transplant_probe.py <steps> <donor> [<donor> ...]

Nothing is published. The warm-up trains ONLY the token embedding table (the body stays as transplanted): the cheapest way a new tokenizer's rows learn to fit a trained body.
Baseline: Sham's best published checkpoint, measured the same way in the same run.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[2]
SHAM = ROOT / "ai-system" / "colab" / "sham_small"
sys.path.insert(0, str(SHAM))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.chdir(SHAM)

import probe as P                                                              # noqa: E402
from checkpoint import load_checkpoint                                         # noqa: E402
from sham_ci_merge import pick_base                                            # noqa: E402
from sham_inputs import fetch_dataset                                          # noqa: E402
from sham_transplant import run as transplant                                  # noqa: E402
from text_tokenizer import ShamTextTokenizer                                   # noqa: E402


def measure(model, tok, T) -> dict[str, float]:
    model.train(False)
    out = {}
    with torch.no_grad():
        for k, text in T.items():
            fn = lambda w: float(model(torch.tensor([w]), labels=torch.tensor([w]))[1])   # noqa: E731
            out[k] = P.bpb(fn, tok.encode, text)[0]
    return out


def warmup(model, tok, train_text: dict[str, str], steps: int, L: int = 128, batch: int = 4, lr: float = 2e-3) -> list[float]:
    """embedding-only training; returns the loss every 10 steps"""
    import random
    for p in model.parameters():
        p.requires_grad_(False)
    model.token_embedding.weight.requires_grad_(True)
    opt = torch.optim.Adam([model.token_embedding.weight], lr=lr)
    streams = {k: tok.encode(v) for k, v in train_text.items()}
    wins = [(k, i) for k, ids in streams.items() for i in range(0, len(ids) - L, L)]
    rng = random.Random(1)
    rng.shuffle(wins)
    losses, t0 = [], time.time()
    model.train(True)
    for s in range(steps):
        xs = [torch.tensor(streams[k][i:i + L]) for k, i in (wins[(s * batch + j) % len(wins)] for j in range(batch))]
        x = torch.stack(xs)
        loss = model(x, labels=x)[1]
        opt.zero_grad()
        loss.backward()
        opt.step()
        if s % 10 == 0 or s == steps - 1:
            losses.append(float(loss))
            print(f"    step {s + 1}/{steps} loss {float(loss):.3f} ({time.time() - t0:.0f}s)", flush=True)
    model.train(False)
    return losses


def main() -> None:
    steps = int(sys.argv[1])
    donors = sys.argv[2:]
    torch.set_num_threads(os.cpu_count() or 4)
    T, TT = P.texts(), P.texts(train=True)
    ckpt, base_dir, label, _p = pick_base(fetch_dataset, probe=None)
    tok_json = sorted(base_dir.rglob("sham_small_tokenizer.json"))[0]
    tok = ShamTextTokenizer.load(str(tok_json))
    base, step, _ = load_checkpoint(ckpt, map_location="cpu")
    rows = [("SHAM " + label + f" step {step}", sum(p.numel() for p in base.parameters()) / 1e6, measure(base, tok, T), None)]
    del base
    for d in donors:
        try:
            out = transplant(d, f"/tmp/transplant/{d.replace('/', '_')}", tok_json)
            m, _s, _ = load_checkpoint(out / "step_000000.pt", map_location="cpu")
            n = sum(p.numel() for p in m.parameters()) / 1e6
            zero = measure(m, tok, T)
            rows.append((f"{d} (transplanted, no training)", n, zero, None))
            print(f"{d}: zero-shot {zero}", flush=True)
            if steps > 0:
                losses = warmup(m, tok, TT, steps)
                rows.append((f"{d} (+{steps} embedding-only steps)", n, measure(m, tok, T), losses))
        except Exception as e:                                                 # noqa: BLE001
            import traceback
            traceback.print_exc()
            print(f"{d}: failed: {type(e).__name__}: {str(e)[:300]}", flush=True)
    print("\n== bits per byte on our text (Sham's tokenizer, lower is better) ==")
    for name, n, r, losses in rows:
        print(f"{name:62s} {n:6.0f}M  ar {r['arabic']:.3f}  en {r['english']:.3f}  code {r['code']:.3f}" + (f"  | train loss {losses[0]:.2f} -> {losses[-1]:.2f}" if losses else ""), flush=True)


if __name__ == "__main__":
    main()
