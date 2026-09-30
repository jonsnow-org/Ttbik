"""
Sham's fixed yardstick ("المقياس الثابت"): the same questions, every run,
never trained on — so the owner sees in Telegram whether Sham actually got
better, not just whether the training loss (on ever-changing data) went down.

Measures:
  - answer_loss: mean loss on the ANSWER tokens of the Arabic rows of
    Aya's TEST split (human-written, apache-2.0, never used for training),
    in Sham's dialogue format. Lower = better. Works for every stage's
    checkpoint, so stages are comparable.
  - repeat_rate / distinct2 on free answers to fixed prompts (the
    "سامي سامي" symptom as a number: repeat_rate should fall toward 0,
    distinct2 rise toward 1).
  - Samples: three real answers, so the owner reads them too.
"""

from __future__ import annotations

import math

import torch

from sham_chat import build_chat_example, pad_batch
from sham_decoding import chat_prompt_ids, guarded_generate_tokens
from model import SpecialTokens

FIXED_PROMPTS = ["ما هي عاصمة سوريا؟", "اكتب جملة عن فوائد القراءة.", "من أنت؟"]


def fixed_eval_pairs(limit: int = 120) -> list[tuple[str, str]]:
    from datasets import load_dataset

    ds = load_dataset("CohereLabs/aya_dataset", split="test")
    ds = ds.filter(lambda r: "Arabic" in (r.get("language") or ""))
    return [(r["inputs"], r["targets"]) for r in ds.select(range(min(limit, len(ds))))]


@torch.no_grad()
def answer_loss(model, tokenizer, pairs, device: str, batch_size: int = 8) -> float:
    model.eval()
    total, count = 0.0, 0
    ex = [build_chat_example(tokenizer.encode(q), tokenizer.encode(a)) for q, a in pairs]
    for s in range(0, len(ex), batch_size):
        ids, labels = pad_batch(ex[s:s + batch_size])
        logits, _ = model(ids.to(device))[:2]
        logits = logits[:, :-1].float()
        target = labels[:, 1:].to(device)
        loss = torch.nn.functional.cross_entropy(
            logits.reshape(-1, logits.size(-1)), target.reshape(-1), ignore_index=-100, reduction="sum")
        total += float(loss)
        count += int((target != -100).sum())
    return total / max(count, 1)


def _repeat_stats(ids: list[int]) -> tuple[float, float]:
    if len(ids) < 3:
        return 0.0, 1.0
    bigrams = list(zip(ids, ids[1:]))
    distinct2 = len(set(bigrams)) / len(bigrams)
    repeats = sum(1 for a, b in zip(ids, ids[1:]) if a == b)
    return repeats / (len(ids) - 1), distinct2


@torch.no_grad()
def sample_answers(model, tokenizer, device: str, chat: bool, max_new_tokens: int = 60):
    out = []
    for q in FIXED_PROMPTS:
        q_ids = tokenizer.encode(q)
        prompt = chat_prompt_ids(q_ids) if chat else [SpecialTokens.BOS] + q_ids
        x = torch.tensor([prompt], dtype=torch.long, device=device)
        torch.manual_seed(0)
        y = guarded_generate_tokens(model, x, max_new_tokens, temperature=0.7, top_k=40, top_p=0.9,
                                    eos_id=SpecialTokens.EOS,
                                    allowed_ranges=[(0, tokenizer.vocab_size)] * max_new_tokens)
        # the same prompt without the anti-loop guard: the model's OWN tendency to loop
        torch.manual_seed(0)
        raw = guarded_generate_tokens(model, x, max_new_tokens, temperature=0.7, top_k=40, top_p=0.9,
                                      eos_id=SpecialTokens.EOS, guard=False,
                                      allowed_ranges=[(0, tokenizer.vocab_size)] * max_new_tokens)
        ids = [i for i in y[0, x.shape[1]:].tolist() if i != SpecialTokens.EOS]
        raw_ids = [i for i in raw[0, x.shape[1]:].tolist() if i != SpecialTokens.EOS]
        out.append((q, tokenizer.decode(ids), _repeat_stats(raw_ids)))
    return out


def evaluate(model, tokenizer, device: str, chat: bool, pairs=None) -> dict:
    pairs = pairs if pairs is not None else fixed_eval_pairs()
    loss = answer_loss(model, tokenizer, pairs, device)
    samples = sample_answers(model, tokenizer, device, chat)
    rr = sum(s[2][0] for s in samples) / len(samples)
    d2 = sum(s[2][1] for s in samples) / len(samples)
    model.train()
    return {"answer_loss": loss, "answer_ppl": math.exp(min(loss, 20)), "repeat_rate": rr,
            "distinct2": d2, "samples": [(q, a) for q, a, _ in samples], "n_eval": len(pairs)}


def format_eval(name: str, step: int, r: dict, before: dict | None = None) -> str:
    def delta(k, fmt="{:+.3f}"):
        return f" ({fmt.format(r[k] - before[k])})" if before and k in before else ""
    lines = [
        f"📏 المقياس الثابت — {name} — الخطوة {step:,}",
        f"خسارة الإجابة (أقل أفضل): {r['answer_loss']:.3f}{delta('answer_loss')} على {r['n_eval']} سؤالاً لم يُدرَّب عليها",
        f"تكرار الكلمة نفسها (أقل أفضل): {r['repeat_rate']:.2f}{delta('repeat_rate', '{:+.2f}')}",
        f"تنوّع العبارات (أعلى أفضل): {r['distinct2']:.2f}{delta('distinct2', '{:+.2f}')}",
    ]
    for q, a in r["samples"]:
        lines.append(f"👤 {q}\n🤖 {a[:200]}")
    if before is not None:  # the session's final report: add what every self-development method did
        from sham_selfdev import summary
        if summary():
            lines.append(summary())
    return "\n".join(lines)
