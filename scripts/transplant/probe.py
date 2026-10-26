"""How good is each candidate donor model at OUR text, compared with Sham's own best checkpoint? Bits per byte (tokenizer-independent), per kind of text.

Why: copying a trained small model's weights into Sham (or into a bigger Nova) only pays when the donor already beats what Sham learned in weeks of free training.
Text: Arabic prose, English prose and code taken from this repository (docs, source): the kind of text Nova and Sham work on. Read-only: nothing is published.

  python scripts/transplant/probe.py HuggingFaceTB/SmolLM2-135M Qwen/Qwen2.5-0.5B ... [--sham]
"""
from __future__ import annotations

import math
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
L = 512
PER_SET_BYTES = 36_000
TRAIN_BYTES = 120_000


def arabic_ratio(s: str) -> float:
    letters = [c for c in s if c.isalpha()]
    return sum("؀" <= c <= "ۿ" for c in letters) / max(len(letters), 1)


def texts(train: bool = False) -> dict[str, str]:
    ar, en, code = [], [], []
    for p in sorted((ROOT / "docs").rglob("*.md")) + [ROOT / "CLAUDE.md", ROOT / "README.md"]:
        try:
            lines = p.read_text(encoding="utf-8").splitlines()
        except Exception:
            continue
        for ln in lines:
            ln = ln.strip()
            if len(ln) < 60 or ln.startswith(("|", "```", "#", "{", "<")):
                continue
            (ar if arabic_ratio(ln) > 0.6 else en if arabic_ratio(ln) < 0.02 else []).append(ln)
    for p in sorted((ROOT / "src" / "lib").glob("*.ts")) + sorted((ROOT / "ai-system" / "colab" / "sham_small").glob("sham_*.py")):
        try:
            code.append(p.read_text(encoding="utf-8")[:6000])
        except Exception:
            continue
    out = {}
    for name, parts in (("arabic", ar), ("english", en), ("code", code)):
        s, buf, n = "", [], 0
        for part in parts:
            n += len(part.encode()) + 1
            if n <= PER_SET_BYTES:
                continue                                                  # the first PER_SET_BYTES are the probe; what follows is training text (never measured)
            if train:
                buf.append(part)
                if n >= PER_SET_BYTES + TRAIN_BYTES:
                    break
        if not train:
            buf, n = [], 0
            for part in parts:
                buf.append(part)
                n += len(part.encode()) + 1
                if n >= PER_SET_BYTES:
                    break
        out[name] = "\n".join(buf)
    return out


def bpb(nll_fn, encode, text: str) -> tuple[float, int]:
    """bits per byte: total next-token loss over the non-overlapping windows / the bytes those windows cover (the share of the text they cover, by tokens)."""
    ids = encode(text)
    wins = [ids[i:i + L] for i in range(0, len(ids) - L + 1, L)]
    if not wins:
        return float("nan"), 0
    total = sum(nll_fn(w) * (len(w) - 1) for w in wins)
    covered = len(wins) * L / len(ids)
    return total / math.log(2) / (len(text.encode("utf-8")) * covered), len(ids)


def run_hf(name: str, T: dict[str, str]) -> None:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    t0 = time.time()
    tok = AutoTokenizer.from_pretrained(name, token=os.environ.get("HF_TOKEN") or None)
    model = AutoModelForCausalLM.from_pretrained(name, torch_dtype=torch.float32, token=os.environ.get("HF_TOKEN") or None).eval()
    n = sum(p.numel() for p in model.parameters()) / 1e6
    cfg = model.config
    row = {}
    with torch.no_grad():
        for k, text in T.items():
            fn = lambda w: float(model(torch.tensor([w]), labels=torch.tensor([w])).loss)   # noqa: E731
            row[k] = bpb(fn, lambda s: tok(s, add_special_tokens=False)["input_ids"], text)
    shape = f"d{getattr(cfg, 'hidden_size', '?')} L{getattr(cfg, 'num_hidden_layers', '?')} h{getattr(cfg, 'num_attention_heads', '?')}/{getattr(cfg, 'num_key_value_heads', '?')} vocab {getattr(cfg, 'vocab_size', '?')}"
    print(f"{name:42s} {n:6.0f}M  ar {row['arabic'][0]:.3f}  en {row['english'][0]:.3f}  code {row['code'][0]:.3f}  bits/byte | tokens/{'/'.join(k[:2] for k in row)}: {'/'.join(str(v[1]) for v in row.values())} | {shape} | {time.time() - t0:.0f}s", flush=True)


def run_sham(T: dict[str, str]) -> None:
    import torch
    sys.path.insert(0, str(ROOT / "ai-system" / "colab" / "sham_small"))
    os.chdir(ROOT / "ai-system" / "colab" / "sham_small")
    from checkpoint import load_checkpoint
    from sham_ci_merge import pick_base
    from sham_inputs import fetch_dataset
    from text_tokenizer import ShamTextTokenizer

    ckpt, base_dir, label, _p = pick_base(fetch_dataset, probe=None)
    model, step, _ = load_checkpoint(ckpt, map_location="cpu")
    model.train(False)
    tok = ShamTextTokenizer.load(str(sorted(base_dir.rglob("sham_small_tokenizer.json"))[0]))
    n = sum(p.numel() for p in model.parameters()) / 1e6
    row = {}
    with torch.no_grad():
        for k, text in T.items():
            fn = lambda w: float(model(torch.tensor([w]), labels=torch.tensor([w]))[1])   # noqa: E731
            row[k] = bpb(fn, tok.encode, text)
    c = model.cfg
    print(f"{'SHAM ' + label + ' step ' + str(step):42s} {n:6.0f}M  ar {row['arabic'][0]:.3f}  en {row['english'][0]:.3f}  code {row['code'][0]:.3f}  bits/byte | tokens/{'/'.join(k[:2] for k in row)}: {'/'.join(str(v[1]) for v in row.values())} | d{c.d_model} L{c.n_layers} h{c.n_heads}/{c.n_kv_heads} vocab {c.vocab_size}", flush=True)


if __name__ == "__main__":
    T = texts()
    print("text sets (bytes):", {k: len(v.encode()) for k, v in T.items()}, flush=True)
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--sham" in sys.argv:
        try:
            run_sham(T)
        except Exception as e:                                   # noqa: BLE001
            print(f"SHAM: could not be measured: {type(e).__name__}: {str(e)[:300]}", flush=True)
    for a in args:
        try:
            run_hf(a, T)
        except Exception as e:                                   # noqa: BLE001
            print(f"{a}: failed: {type(e).__name__}: {str(e)[:300]}", flush=True)
