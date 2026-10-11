
"""
Teaching the model to USE long and retrieved context (2026-10-11). The parity measurement on the real checkpoint (step 61,555) showed why
retrieval cannot match a contiguous context yet: with the whole earlier document the loss is 3.702, with only the last 512 tokens 3.710 — the
model barely looks back at all — and chunks packed in by a similarity key made it slightly worse (3.73-3.75), while the best possible chunks
(chosen by measured benefit) would have made it better (3.678). The ability to look back has to be trained. This module builds that training:

  1. recall tasks across distance (copy / key-value recall): a short real passage is planted somewhere far back; later its first half is
     repeated and the model must continue with the second half. Loss on the continuation only. The haystack is real text. This is the
     standard way to build induction / retrieval ability (needle-style training); nothing in it is an answer written by hand.
  2. natural text with retrieved chunks: a long real document, the tail's target predicted from anchor + retrieved chunks + tail — exactly the
     context the long generator builds, so training and use match. Retrieval keys: the embedding key (cheap) with some random chunks mixed in
     (so the model learns to ignore a useless chunk), and in a fraction of examples the oracle-best chunks.

  build_recall_example(doc_ids, rng, budget)  -> (ids, labels)    ids = anchor + chunks + tail with the repeated half; labels -100 elsewhere
  build_retrieval_example(doc_ids, rng, budget, model)  -> (ids, labels)
  train(model, docs, minutes, ...)  -> stats   (AdamW, cosine, grad clip; bf16 autocast on GPU)

Offline self-test: python sham_longctx_train.py (a tiny model must learn the recall task: accuracy on the planted continuation goes up).
"""
from __future__ import annotations

import math
import random
import time

import torch
import torch.nn.functional as F

CHUNK = 64


def build_recall_example(doc: list[int], rng: random.Random, budget: int = 512, span: int = 24) -> tuple[list[int], list[int]]:
    """Context = [part of the document] [needle passage somewhere in it] [more document] [needle's first half again] -> needle's second half.
    Total length <= budget. Loss only on the second half (labels elsewhere -100)."""
    half = span // 2
    need_len = span + 8
    assert len(doc) >= budget, "document too short for the budget"
    start = rng.randrange(0, len(doc) - budget + 1)
    window = doc[start:start + budget]
    # the planted passage is taken from ANOTHER place of the same document so it is real, in-domain text
    n0 = rng.randrange(0, len(doc) - span)
    needle = doc[n0:n0 + span]
    room = budget - (half + span)               # the repeated half + the continuation come after the haystack
    hay = window[:room]
    cut = rng.randrange(8, max(9, room - span - 8))
    body = hay[:cut] + needle + hay[cut:]
    body = body[:budget - half - half]
    ids = body + needle[:half] + needle[half:]
    labels = [-100] * (len(ids) - half) + needle[half:]
    return ids, labels


def build_retrieval_example(doc: list[int], rng: random.Random, budget: int, model, tail: int = 224, anchor: int = 32,
                            k: int = 4, target: int = 128, mix_random: float = 0.25) -> tuple[list[int], list[int]]:
    """anchor + k retrieved 64-token chunks (some of them random on purpose) + tail, then `target` tokens to predict (loss on them only)."""
    from sham_longctx import TokenBank, chunk_key
    n = len(doc)
    assert n >= anchor + k * CHUNK + tail + target + CHUNK * 4
    t_end = rng.randrange(anchor + k * CHUNK + tail + CHUNK * 4, n - target + 1)     # where the prediction target starts
    tail_ids = doc[t_end - tail:t_end]
    cands = list(range(anchor, t_end - tail - CHUNK, CHUNK))
    bank = TokenBank()
    for c0 in cands:
        bank.add(doc[c0:c0 + CHUNK], chunk_key(model, doc[c0:c0 + CHUNK]))
    q = chunk_key(model, tail_ids[-CHUNK * 2:])
    got = [cands[i] for i in bank.retrieve(q, k)]
    got = [rng.choice(cands) if rng.random() < mix_random else c for c in got]
    ids = list(doc[:anchor])
    for c0 in sorted(got):
        ids += doc[c0:c0 + CHUNK]
    ids += tail_ids
    tgt = doc[t_end:t_end + target]
    labels = [-100] * len(ids) + tgt
    return ids + tgt, labels


def _batch(examples, pad: int = 0):
    L = max(len(e[0]) for e in examples)
    ids = torch.full((len(examples), L), pad, dtype=torch.long)
    lab = torch.full((len(examples), L), -100, dtype=torch.long)
    for i, (a, b) in enumerate(examples):
        ids[i, :len(a)] = torch.tensor(a)
        lab[i, :len(b)] = torch.tensor(b)
    return ids, lab


def recall_accuracy(model, docs, rng, n: int = 32, budget: int = 256, device: str = "cpu") -> float:
    """Fraction of planted continuation tokens predicted exactly (greedy, teacher forcing)."""
    model.train(False)
    hit = tot = 0
    with torch.no_grad():
        for _ in range(n):
            ids, lab = build_recall_example(rng.choice(docs), rng, budget)
            x = torch.tensor([ids], device=device)
            pred = model(x)[0][0].argmax(-1)
            for i in range(1, len(ids)):
                if lab[i] != -100:
                    tot += 1
                    hit += int(pred[i - 1] == lab[i])
    model.train(True)
    return hit / max(tot, 1)


def train(model, docs: list[list[int]], minutes: float, budget: int = 512, batch_size: int = 8, lr: float = 1e-4, device: str | None = None,
          recall_fraction: float = 0.5, seed: int = 0, max_steps: int | None = None, log_every: int = 50, warmup: int = 50) -> dict:
    device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    rng = random.Random(seed)
    model.to(device).train(True)
    opt = torch.optim.AdamW(model.parameters(), lr=lr, betas=(0.9, 0.95), weight_decay=0.01)
    amp = torch.bfloat16 if device == "cuda" and torch.cuda.is_bf16_supported() else None
    t0, step, hist = time.time(), 0, []
    big = [d for d in docs if len(d) >= budget + 64]
    long_docs = [d for d in docs if len(d) >= 32 + 4 * CHUNK + 224 + 128 + 4 * CHUNK + 4 * CHUNK]
    while time.time() - t0 < minutes * 60 and (max_steps is None or step < max_steps):
        progress = (time.time() - t0) / (minutes * 60) if max_steps is None else step / max_steps
        cur = lr * min(1.0, (step + 1) / warmup) * (0.5 * (1 + math.cos(math.pi * min(progress, 1.0))) * 0.9 + 0.1)
        for g in opt.param_groups:
            g["lr"] = cur
        ex = []
        for _ in range(batch_size):
            if rng.random() < recall_fraction or not long_docs:
                ex.append(build_recall_example(rng.choice(big), rng, budget))
            else:
                ex.append(build_retrieval_example(rng.choice(long_docs), rng, budget, model))
        ids, lab = _batch(ex)
        ids, lab = ids.to(device), lab.to(device)
        with torch.autocast(device_type=device, dtype=amp, enabled=amp is not None):
            logits = model(ids)[0]
        loss = F.cross_entropy(logits[:, :-1].float().reshape(-1, logits.shape[-1]), lab[:, 1:].reshape(-1), ignore_index=-100)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        step += 1
        hist.append(float(loss.detach()))
        if step % log_every == 0:
            print(f"  خطوة {step:,}: خسارة المهارة {sum(hist[-log_every:]) / log_every:.4f} | lr {cur:.2e}", flush=True)
    model.to("cpu")
    return {"steps": step, "seconds": time.time() - t0, "first": sum(hist[:10]) / max(len(hist[:10]), 1), "last": sum(hist[-10:]) / max(len(hist[-10:]), 1)}


if __name__ == "__main__":
    from model import ShamSmall, ShamSmallConfig

    torch.manual_seed(0)
    rng = random.Random(1)
    cfg = ShamSmallConfig(vocab_size=200, d_model=96, n_layers=3, n_heads=4, n_kv_heads=2, mlp_hidden=192, max_seq_len=512)
    model = ShamSmall(cfg)
    # "documents": text-like token streams with local structure (a random walk over a small vocabulary), different per document
    docs = []
    for _ in range(40):
        base = [rng.randrange(5, 190)]
        for _ in range(1200):
            base.append((base[-1] * 7 + rng.randrange(0, 9)) % 185 + 5)
        docs.append(base)
    ids, lab = build_recall_example(docs[0], rng, 256)
    assert len(ids) <= 256 and sum(1 for v in lab if v != -100) == 12 and ids[-12:] == [v for v in lab if v != -100]
    ex, lx = build_retrieval_example(docs[0], rng, 512, model)
    assert len(ex) == len(lx) and sum(1 for v in lx if v != -100) == 128
    before = recall_accuracy(model, docs, random.Random(5))
    stats = train(model, docs, minutes=20, budget=256, batch_size=16, lr=1e-3, max_steps=1500, recall_fraction=1.0, log_every=500, warmup=20)
    after = recall_accuracy(model, docs, random.Random(5))
    print(f"recall accuracy {before:.2f} -> {after:.2f} | loss {stats['first']:.2f} -> {stats['last']:.2f} in {stats['steps']} steps")
    assert after > before + 0.2 and stats["last"] < stats["first"], "the model must learn to recall a planted passage from far back"
    print("sham_longctx_train self-test OK")
