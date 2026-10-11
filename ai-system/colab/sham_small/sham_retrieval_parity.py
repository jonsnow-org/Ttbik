"""
Does the model treat RETRIEVED chunks like it treats ordinary context? (owner's requirement, 2026-10-11)

For documents long enough to give a real long-range signal, the loss on the last T tokens is measured under the SAME context budget, with:

  A  full      the whole earlier document as one contiguous context (what "no retrieval" means when the window is big enough)
  B  window    only the most recent tokens (no retrieval, no memory) — what a small window gives today
  C1 packed    anchor + retrieved chunks + tail, positions packed 0..n-1 (retrieved text looks like it was always there)
  C2 true      the same tokens, each at its TRUE original position (gaps), so the relative distances are the real ones
  O  oracle    like C2 but the chunks are chosen by their measured benefit (the ceiling for any retrieval key)
  keys: emb (mean token embedding) and hid (mean of the final hidden states)

parity = (B - X) / (B - A): 1.0 = retrieval is as good as the full context, 0 = as bad as having no memory, <0 = worse than no memory.
Output: plain lines. The "far" set repeats it on 6k-token documents with the rope table NTK-extended (nothing is trained there).
Offline self-test (no Kaggle credentials): a tiny random model, synthetic documents — proves the machinery, says nothing about quality.
"""
from __future__ import annotations

import math
import os
import sys
import time
from pathlib import Path

import torch
import torch.nn.functional as F

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sham_longctx import extend_context_ntk, forward_positions, TokenBank, chunk_key  # noqa: E402

CHUNK = 64
ANCHOR = 32
TARGET = 128


@torch.no_grad()
def hidden_key(model, ids: list[int]) -> torch.Tensor:
    x = model.token_embedding(torch.tensor([ids], dtype=torch.long))
    cos, sin = model.rope_cos[: len(ids)], model.rope_sin[: len(ids)]
    for layer in model.layers:
        x, _ = layer(x, cos, sin, past_kv=None, use_cache=False)
    h = model.final_norm(x)[0].float().mean(dim=0)
    return h / h.norm().clamp_min(1e-8)


@torch.no_grad()
def target_loss(model, ctx_ids, ctx_pos, tgt_ids, tgt_pos) -> float:
    ids = torch.tensor([list(ctx_ids) + list(tgt_ids)], dtype=torch.long)
    pos = torch.tensor(list(ctx_pos) + list(tgt_pos))
    logits, _ = forward_positions(model, ids, pos)
    lg = logits[0, len(ctx_ids) - 1:-1]
    return float(F.cross_entropy(lg, torch.tensor(list(tgt_ids))))


def _chunks(region_start: int, region_end: int):
    s = region_start
    while s + CHUNK <= region_end:
        yield s
        s += CHUNK


def retrieved_context(model, doc, n_ctx, budget, key="emb", k=None, oracle_target=None):
    """anchor + retrieved chunks + tail within `budget` context tokens. Returns (ids, true_positions, chosen chunk starts)."""
    tail_len = budget - ANCHOR - (k * CHUNK if k is not None else 0)
    k = k if k is not None else 0
    tail_start = n_ctx - tail_len
    cands = list(_chunks(ANCHOR, tail_start))
    tail = doc[tail_start:n_ctx]
    chosen: list[int] = []
    if k and cands:
        if oracle_target is not None:
            # greedy: add the chunk whose presence lowers the target loss the most, k times
            tgt_ids, tgt_pos = oracle_target
            base_ids, base_pos = doc[:ANCHOR], list(range(ANCHOR))
            for _ in range(min(k, len(cands))):
                best, best_loss = None, 1e9
                for c0 in cands:
                    if c0 in chosen:
                        continue
                    pick = sorted(chosen + [c0])
                    ids = list(base_ids)
                    pos = list(base_pos)
                    for p0 in pick:
                        ids += doc[p0:p0 + CHUNK]
                        pos += list(range(p0, p0 + CHUNK))
                    ids += tail
                    pos += list(range(tail_start, n_ctx))
                    loss = target_loss(model, ids, pos, tgt_ids, tgt_pos)
                    if loss < best_loss:
                        best, best_loss = c0, loss
                chosen.append(best)
        else:
            kf = (lambda ids: hidden_key(model, ids)) if key == "hid" else (lambda ids: chunk_key(model, ids))
            bank = TokenBank()
            for c0 in cands:
                bank.add(doc[c0:c0 + CHUNK], kf(doc[c0:c0 + CHUNK]))
            q = kf(tail[-CHUNK * 2:])
            chosen = [cands[i] for i in bank.retrieve(q, k)]
    chosen.sort()
    ids, pos = list(doc[:ANCHOR]), list(range(ANCHOR))
    for p0 in chosen:
        ids += doc[p0:p0 + CHUNK]
        pos += list(range(p0, p0 + CHUNK))
    ids += tail
    pos += list(range(tail_start, n_ctx))
    return ids, pos, chosen


def evaluate_doc(model, doc: list[int], n_ctx: int, budget: int = 512, k: int = 4, do_oracle: bool = True) -> dict:
    tgt_ids = doc[n_ctx:n_ctx + TARGET]
    tgt_pos = list(range(n_ctx, n_ctx + len(tgt_ids)))
    out = {}
    out["A"] = target_loss(model, doc[:n_ctx], list(range(n_ctx)), tgt_ids, tgt_pos)
    out["B"] = target_loss(model, doc[n_ctx - budget:n_ctx], list(range(n_ctx - budget, n_ctx)), tgt_ids, tgt_pos)
    for key in ("emb", "hid"):
        ids, pos, _ = retrieved_context(model, doc, n_ctx, budget, key=key, k=k)
        packed = list(range(len(ids)))
        out[f"C1_{key}"] = target_loss(model, ids, packed, tgt_ids, list(range(len(ids), len(ids) + len(tgt_ids))))
        out[f"C2_{key}"] = target_loss(model, ids, pos, tgt_ids, tgt_pos)
    if do_oracle:
        ids, pos, _ = retrieved_context(model, doc, n_ctx, budget, k=k, oracle_target=(tgt_ids, tgt_pos))
        out["O"] = target_loss(model, ids, pos, tgt_ids, tgt_pos)
    return out


def summarize(rows: list[dict], title: str) -> list[str]:
    if not rows:
        return [f"{title}: لا وثائق كافية"]
    keys = rows[0].keys()
    mean = {k: sum(r[k] for r in rows) / len(rows) for k in keys}
    lines = [f"{title} — {len(rows)} وثيقة، الخسارة على آخر {TARGET} رمزاً (أقل أفضل):"]
    lines.append("  A سياق كامل متصل {:.3f} | B نافذة قصيرة بلا استرجاع {:.3f}".format(mean["A"], mean["B"]))
    gap = mean["B"] - mean["A"]
    for k in keys:
        if k in ("A", "B"):
            continue
        par = (mean["B"] - mean[k]) / gap if abs(gap) > 1e-6 else float("nan")
        lines.append(f"  {k}: {mean[k]:.3f} | تكافؤ {par:+.2f}")
    if gap <= 0:
        lines.append("  ⚠ السياق الكامل لا يتفوق على النافذة القصيرة هنا: التكافؤ غير ذي معنى")
    return lines


def collect_docs(tok, min_tokens: int, want: int, max_documents: int = 400) -> list[list[int]]:
    import sham_text_mix
    work = Path("/tmp/sham_parity_text")
    files = sham_text_mix.stream_mix(str(work), max_documents=max_documents, seed=4242, documents_per_file=100)
    docs = []
    for f in files:
        if not f.endswith(".txt"):
            continue
        for d in Path(f).read_text(encoding="utf-8").split("\n\n"):
            if len(d) > min_tokens * 2:
                ids = tok.encode(d)
                if len(ids) >= min_tokens:
                    docs.append(ids)
    return docs[:want]


def main() -> int:
    from checkpoint import load_checkpoint
    from sham_inputs import fetch_dataset
    from text_tokenizer import ShamTextTokenizer

    name = os.environ.get("SHAM_PARITY_DATASET", "sham-multimodal-checkpoint")
    root = fetch_dataset(name)
    ckpt = sorted(root.rglob("final_*.pt")) + sorted(root.rglob("final.pt"))
    model, step, _ = load_checkpoint(ckpt[0], map_location="cpu")
    model.eval()
    tok = ShamTextTokenizer.load(str(sorted(root.rglob("sham_small_tokenizer.json"))[0]))
    print(f"النموذج: {name} خطوة {step:,} | نافذته {model.cfg.max_seq_len} | مفردات المُرمِّز {tok.vocab_size}")
    t0 = time.time()

    n_ctx = 1920 if model.cfg.max_seq_len >= 2048 else model.cfg.max_seq_len - TARGET
    docs = collect_docs(tok, n_ctx + TARGET, want=16)
    rows = [evaluate_doc(model, d[:n_ctx + TARGET], n_ctx) for d in docs]
    for line in summarize(rows, f"داخل النافذة الأصلية (سياق متاح {n_ctx} رمزاً، ميزانية كل طريقة 512)"):
        print(line)
    print(f"({time.time() - t0:.0f} ث)")

    far = collect_docs(tok, 6144 + TARGET, want=4)
    if far:
        extend_context_ntk(model, 8192)
        n_far = 6144
        rows_far = [evaluate_doc(model, d[:n_far + TARGET], n_far, do_oracle=False) for d in far]
        for line in summarize(rows_far, "بعيد (6144 رمزاً، المواضع ممددة NTK دون تدريب)"):
            print(line)
    else:
        print("بعيد: لا وثائق بطول 6k في العيّنة")
    return 0


if __name__ == "__main__":
    if not (os.environ.get("KAGGLE_USERNAME") or os.environ.get("KAGGLE_API_TOKEN")):
        # offline self-test: random model, synthetic documents; proves the machinery (shapes, budgets, parity arithmetic), not quality
        from model import ShamSmall, ShamSmallConfig
        torch.manual_seed(0)
        cfg = ShamSmallConfig(vocab_size=400, d_model=32, n_layers=2, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=1024)
        m = ShamSmall(cfg).eval()
        doc = torch.randint(0, 400, (1024,)).tolist()
        r = evaluate_doc(m, doc, 896, budget=256, k=2)
        assert {"A", "B", "C1_emb", "C2_emb", "C1_hid", "C2_hid", "O"} <= set(r) and all(math.isfinite(v) for v in r.values()), r
        ids, pos, chosen = retrieved_context(m, doc, 896, 256, k=2)
        assert len(ids) == 256 and pos == sorted(pos) and len(set(pos)) == len(pos) and len(chosen) == 2
        assert all(c % 1 == 0 and ANCHOR <= c < 896 - (256 - ANCHOR - 2 * CHUNK) for c in chosen)
        lines = summarize([r, r], "اختبار")
        assert len(lines) >= 6
        print("sham_retrieval_parity self-test OK")
        sys.exit(0)
    sys.exit(main())
