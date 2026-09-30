"""
Sham's grounded self-reward ("المكافأة الذاتية المرتكزة") — Sham improves
from its OWN attempts, with no outside model as judge:

  1. For questions that have a human-written reference answer, Sham writes K
     answers of its own (sampled, anti-loop guarded, in its dialogue format).
  2. Each attempt is scored against the reference with a character-n-gram F
     score (robust to Arabic morphology — prefixes/suffixes still earn partial
     credit), times a no-repetition factor, plus a small bonus for ending
     cleanly with <EOS>. This is a grounded reward: it can't be "gamed" by
     confident nonsense the way a model judging itself could.
  3. Best vs. worst attempt become a preference pair; one DPO pass (Rafailov
     et al., 2023) — against a frozen copy of Sham from before the round —
     pushes Sham toward its own best behaviour and away from its worst,
     plus a light likelihood term on the best answer to keep it anchored.
  4. The guard: the round is kept only if Sham's loss on held-out answers
     doesn't get worse; otherwise every weight is restored exactly.

Why this beats plain SFT on the same data: SFT only shows the right answer;
this also shows Sham its OWN typical mistakes (loops, drifting off-topic,
never stopping) and explicitly pushes probability away from them.
"""

from __future__ import annotations

import copy
from collections import Counter

import torch
import torch.nn.functional as F

from model import SpecialTokens
from sham_decoding import chat_prompt_ids, guarded_generate_tokens


def char_ngram_f(candidate: str, reference: str, n: int = 3) -> float:
    def grams(t):
        t = " ".join(t.split())
        return Counter(t[i:i + n] for i in range(max(len(t) - n + 1, 0)))
    c, r = grams(candidate), grams(reference)
    if not c or not r:
        return 0.0
    overlap = sum((c & r).values())
    p, rec = overlap / sum(c.values()), overlap / sum(r.values())
    return 0.0 if overlap == 0 else 2 * p * rec / (p + rec)


def repetition_factor(ids: list[int]) -> float:
    if len(ids) < 4:
        return 1.0
    grams = list(zip(ids, ids[1:], ids[2:]))
    return len(set(grams)) / len(grams)


def score_attempt(text: str, ids: list[int], ended: bool, reference: str) -> float:
    return char_ngram_f(text, reference) * repetition_factor(ids) + (0.05 if ended else 0.0)


@torch.no_grad()
def make_pairs(model, tokenizer, qa: list[tuple[str, str]], device: str, k: int = 4,
               max_new_tokens: int = 64, min_gap: float = 0.05) -> list[tuple[list[int], list[int], list[int]]]:
    """[(prompt_ids, chosen_ids, rejected_ids)] — ids include the final <EOS>
    when the attempt ended on its own."""
    pairs = []
    for q, ref in qa:
        prompt = chat_prompt_ids(tokenizer.encode(q)[:192])
        x = torch.tensor([prompt] * k, dtype=torch.long, device=device)
        out = guarded_generate_tokens(model, x, max_new_tokens, temperature=0.9, top_k=50, top_p=0.95,
                                      eos_id=SpecialTokens.EOS,
                                      allowed_ranges=[(0, tokenizer.vocab_size)] * max_new_tokens)
        scored = []
        for row in out[:, len(prompt):].tolist():
            ended = SpecialTokens.EOS in row
            ids = row[:row.index(SpecialTokens.EOS) + 1] if ended else row
            text_ids = [t for t in ids if t != SpecialTokens.EOS]
            scored.append((score_attempt(tokenizer.decode(text_ids), text_ids, ended, ref), ids))
        scored.sort(key=lambda s: s[0], reverse=True)
        best, worst = scored[0], scored[-1]
        if best[0] - worst[0] >= min_gap and best[1] != worst[1]:
            pairs.append((prompt, best[1], worst[1]))
    return pairs


def _seq_logprob(model, prompt: list[int], answer: list[int], device: str) -> torch.Tensor:
    ids = torch.tensor([prompt + answer], dtype=torch.long, device=device)
    logits = model(ids)[0][0, :-1].float()
    target = ids[0, 1:]
    lp = F.log_softmax(logits, dim=-1).gather(1, target[:, None])[:, 0]
    return lp[len(prompt) - 1:].sum()


def dpo_round(model, pairs, device: str, lr: float = 2e-6, beta: float = 0.1, sft_weight: float = 0.2) -> float:
    """One pass of DPO over the pairs against a frozen pre-round copy.
    Returns the mean DPO loss."""
    ref = copy.deepcopy(model).eval()
    for p in ref.parameters():
        p.requires_grad_(False)
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=lr, weight_decay=0.0)
    model.train()
    losses = []
    for prompt, chosen, rejected in pairs:
        pc, pr = _seq_logprob(model, prompt, chosen, device), _seq_logprob(model, prompt, rejected, device)
        with torch.no_grad():
            rc, rr = _seq_logprob(ref, prompt, chosen, device), _seq_logprob(ref, prompt, rejected, device)
        loss = -F.logsigmoid(beta * ((pc - rc) - (pr - rr))) - sft_weight * pc / max(len(chosen), 1)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        opt.zero_grad()
        losses.append(float(loss.detach()))
    del ref
    return sum(losses) / max(len(losses), 1)


def guarded_self_reward(model, tokenizer, qa, device: str, gate_fn, k: int = 4, tolerance: float = 0.002) -> str:
    """Full round with the guard. gate_fn(model) -> held-out loss (lower is
    better). Returns a one-line Arabic report."""
    saved = {n: p.detach().clone() for n, p in model.named_parameters()}
    before = gate_fn(model)
    from sham_selfdev import record
    pairs = make_pairs(model, tokenizer, qa, device, k=k)
    if not pairs:
        record("المكافأة الذاتية", "لم تعمل: كل محاولات شام متقاربة، لا إشارة يتعلم منها")
        return "🔁 المكافأة الذاتية: لا أزواج مفيدة هذه الجلسة (كل المحاولات متقاربة)."
    dpo_loss = dpo_round(model, pairs, device)
    after = gate_fn(model)
    if after <= before * (1 + tolerance):
        record("المكافأة الذاتية", f"✅ قُبلت — {len(pairs)} زوج، خسارة التحقق {before:.3f} → {after:.3f}")
        return (f"🔁 المكافأة الذاتية: ✅ قُبلت — {len(pairs)} زوج (أفضل/أسوأ من محاولاته)، "
                f"خسارة التحقق {before:.3f} → {after:.3f}")
    with torch.no_grad():
        for n, p in model.named_parameters():
            p.copy_(saved[n])
    record("المكافأة الذاتية", f"❌ رُفضت وأُعيدت الأوزان — خسارة التحقق {before:.3f} → {after:.3f}")
    return f"🔁 المكافأة الذاتية: ❌ رُفضت وأُعيدت الأوزان — خسارة التحقق {before:.3f} → {after:.3f}"


if __name__ == "__main__":
    assert char_ngram_f("عاصمة سوريا دمشق", "دمشق هي عاصمة سوريا") > char_ngram_f("القطة نائمة", "دمشق هي عاصمة سوريا")
    assert repetition_factor([1, 2, 1, 2, 1, 2, 1, 2]) < repetition_factor([1, 2, 3, 4, 5, 6, 7, 8])
    print("sham_reward self-test OK")
