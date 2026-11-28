"""Calibrates the 'excellent' targets from MEASUREMENT, not from guesses (the same principle as OneCore's promotion-thresholds.json: 'do not fill these with arbitrary values').

A fixed, held-out calibration set (Arabic Wikipedia, English Wikipedia, Python source) is scored in BITS PER BYTE (tokenizer-independent: it compares our byte-fallback BPE with any other
tokenizer fairly) by (a) byte n-gram language models trained ON THE OTHER DOCUMENTS of the same set (a floor any neural model must beat) and (b) open reference models of two sizes. These
numbers are evaluation yardsticks only: no reference model's OUTPUT is ever used to train Qalam. Usage: python calibrate.py SAMPLES.json OUT.json MODEL_DIR[,MODEL_DIR...]"""
from __future__ import annotations

import hashlib
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path


def ngram_bpb(docs: list[str], order: int, folds: int = 5) -> float:
    """Byte n-gram with interpolated absolute-discounting smoothing, cross-validated by document (a document never helps score itself)."""
    data = [d.encode("utf-8") for d in docs]
    total_bits, total_bytes = 0.0, 0
    for k in range(folds):
        train = [x for i, x in enumerate(data) if i % folds != k]
        test = [x for i, x in enumerate(data) if i % folds == k]
        counts = [defaultdict(Counter) for _ in range(order)]
        for x in train:
            for i in range(len(x)):
                for n in range(order):
                    if i >= n:
                        counts[n][x[i - n:i]][x[i]] += 1
        D = 0.75
        for x in test:
            for i in range(len(x)):
                p = 1.0 / 256
                for n in range(order):
                    if i < n:
                        break
                    c = counts[n].get(x[i - n:i])
                    if not c:
                        break
                    tot = sum(c.values())
                    lam = D * len(c) / tot
                    p = max(c.get(x[i], 0) - D, 0) / tot + lam * p
                total_bits += -math.log2(max(p, 1e-12))
            total_bytes += len(x)
    return total_bits / total_bytes


def model_bpb(model_dir: str, docs: list[str], ctx: int = 1024) -> dict:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    tok = AutoTokenizer.from_pretrained(model_dir)
    model = AutoModelForCausalLM.from_pretrained(model_dir, torch_dtype=torch.float32).eval()
    nats, nbytes = 0.0, 0
    with torch.no_grad():
        for d in docs:
            ids = tok(d, return_tensors="pt").input_ids[0]
            if tok.bos_token_id is not None and ids[0] != tok.bos_token_id:
                ids = torch.cat([torch.tensor([tok.bos_token_id]), ids])
            elif tok.bos_token_id is None and tok.eos_token_id is not None:
                ids = torch.cat([torch.tensor([tok.eos_token_id]), ids])             # a start token so the first real token is predicted too
            for a in range(0, len(ids) - 1, ctx):
                chunk = ids[a:a + ctx + 1]
                if len(chunk) < 2:
                    continue
                logits = model(chunk[:-1][None]).logits[0].float()
                nats += float(torch.nn.functional.cross_entropy(logits, chunk[1:], reduction="sum"))
            nbytes += len(d.encode("utf-8"))
    return {"bits_per_byte": nats / math.log(2) / nbytes, "bytes": nbytes, "params": sum(p.numel() for p in model.parameters())}


def main() -> None:
    samples = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    out = {"set": {k: {"docs": len(v), "bytes": sum(len(x.encode()) for x in v), "sha256": hashlib.sha256("\n".join(v).encode()).hexdigest()} for k, v in samples.items()},
           "ngram": {}, "models": {}}
    for dom, docs in samples.items():
        out["ngram"][dom] = {f"order{n}": round(ngram_bpb(docs, n), 4) for n in (1, 3, 5)}
        print(dom, out["ngram"][dom], flush=True)
    for md in sys.argv[3].split(","):
        name = Path(md).name
        out["models"][name] = {dom: model_bpb(md, docs) for dom, docs in samples.items()}
        for dom, r in out["models"][name].items():
            r["bits_per_byte"] = round(r["bits_per_byte"], 4)
        print(name, out["models"][name], flush=True)
        Path(sys.argv[2]).write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
