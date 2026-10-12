"""
Sham's verifiable-reward reasoning stage (GRPO, Shao et al. 2024) — built
now, ASLEEP until Sham is ready for it.

GRPO needs some of Sham's attempts to be right: it samples a GROUP of
answers per question and pushes toward the ones that beat the group's
average. If every attempt is wrong there is nothing to learn from, so each
session first MEASURES Sham on fresh verifiable questions and the stage
wakes up by itself only when the success rate passes WAKE_AT. No answer is
ever written by rules: the checkers only SCORE Sham's own attempts during
training; everything Sham says, it learned.

Verifiable tasks (generated fresh, never repeated, answers checked exactly):
  arithmetic   كم يساوي 17 + 25؟  (addition, subtraction, multiplication)
  next number  ما العدد الذي يلي 399؟
  compare      أيهما أكبر: 64 أم 46؟
Digits in either Western (0-9) or Arabic-Indic (٠-٩) form are accepted.

The round is guarded like the self-reward round: kept only if held-out loss
does not get worse; otherwise every weight is restored exactly.
"""

from __future__ import annotations

import copy
import random
import re

import torch
import torch.nn.functional as F

from model import SpecialTokens
from sham_decoding import chat_prompt_ids, guarded_generate_tokens

WAKE_AT = 0.05
GROUP = 4
_ARABIC_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩", "0123456789")


def make_task(rng: random.Random) -> tuple[str, str]:
    kind = rng.choice(("add", "sub", "mul", "next", "cmp"))
    a, b = rng.randint(2, 99), rng.randint(2, 99)
    if kind == "add":
        return f"كم يساوي {a} + {b}؟", str(a + b)
    if kind == "sub":
        a, b = max(a, b), min(a, b)
        return f"كم يساوي {a} - {b}؟", str(a - b)
    if kind == "mul":
        a, b = a % 13 + 2, b % 13 + 2
        return f"كم يساوي {a} × {b}؟", str(a * b)
    if kind == "next":
        n = rng.randint(1, 999)
        return f"ما العدد الذي يلي {n}؟", str(n + 1)
    if a == b:
        b += 1
    return f"أيهما أكبر: {a} أم {b}؟", str(max(a, b))


def check(answer_text: str, truth: str) -> bool:
    """Right if the FIRST number Sham writes is the true one — or, when the answer is a worked solution with a final line
    «الناتج: …» / «Answer: …», if THAT final answer is the true one (a scratchpad is full of intermediate numbers)."""
    from sham_reasoning_data import MARK_AR, MARK_EN, check_final
    if MARK_AR in answer_text or MARK_EN in answer_text:
        return check_final(answer_text, truth)
    nums = re.findall(r"\d+", answer_text.translate(_ARABIC_DIGITS))
    return bool(nums) and nums[0] == truth


def _reasoning_on() -> bool:
    try:
        from sham_reasoning_data import share
        return share() > 0
    except Exception:
        return False


def _task(rng: random.Random) -> tuple[str, str]:
    """A fresh verifiable question: the worked-solution kinds when the reasoning curriculum is on (the model must then write
    its steps, so it also needs room to), else the original five."""
    if _reasoning_on():
        from sham_reasoning_data import make_problem
        p = make_problem(rng)
        return p["question"], p["truth"]
    return make_task(rng)


def _repetition(ids: list[int]) -> float:
    grams = list(zip(ids, ids[1:], ids[2:]))
    return 1.0 if len(grams) < 2 else len(set(grams)) / len(grams)


@torch.no_grad()
def _attempts(model, tokenizer, question: str, device: str, k: int, max_new_tokens: int | None = None, temperature=0.9):
    max_new_tokens = max_new_tokens or (96 if _reasoning_on() else 24)
    prompt = chat_prompt_ids(tokenizer.encode(question))
    x = torch.tensor([prompt] * k, dtype=torch.long, device=device)
    out = guarded_generate_tokens(model, x, max_new_tokens, temperature=temperature, top_k=50, top_p=0.95,
                                  eos_id=SpecialTokens.EOS,
                                  allowed_ranges=[(0, tokenizer.vocab_size)] * max_new_tokens)
    rows = []
    for row in out[:, len(prompt):].tolist():
        ended = SpecialTokens.EOS in row
        ids = row[:row.index(SpecialTokens.EOS) + 1] if ended else row
        rows.append((ids, ended, tokenizer.decode([t for t in ids if t != SpecialTokens.EOS])))
    return prompt, rows


def success_rate(model, tokenizer, device: str, n: int = 32, seed: int = 0) -> float:
    rng = random.Random(seed)
    model.eval()
    hits = 0
    for _ in range(n):
        q, truth = _task(rng)
        _, rows = _attempts(model, tokenizer, q, device, 1, temperature=0.3)
        hits += check(rows[0][2], truth)
    return hits / n


def reward(text: str, ids: list[int], ended: bool, truth: str) -> float:
    return (1.0 if check(text, truth) else 0.0) + (0.1 if ended else 0.0) - 0.2 * (1 - _repetition(ids))


def _logprob(model, prompt, ids, device):
    x = torch.tensor([prompt + ids], dtype=torch.long, device=device)
    logits = model(x)[0][0, :-1].float()
    lp = F.log_softmax(logits, -1).gather(1, x[0, 1:, None])[:, 0]
    return lp[len(prompt) - 1:]


def grpo_round(model, tokenizer, device: str, questions: int = 48, seed: int = 0,
               lr: float = 2e-6, beta: float = 0.04) -> dict:
    rng = random.Random(seed)
    ref = copy.deepcopy(model).eval()
    for p in ref.parameters():
        p.requires_grad_(False)
    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=lr, weight_decay=0.0)
    used, rewards = 0, []
    for _ in range(questions):
        q, truth = _task(rng)
        model.eval()
        prompt, rows = _attempts(model, tokenizer, q, device, GROUP)
        r = torch.tensor([reward(t, ids, e, truth) for ids, e, t in rows])
        rewards += r.tolist()
        if float(r.std()) < 1e-6:
            continue  # the whole group scored the same: no signal
        adv = (r - r.mean()) / (r.std() + 1e-6)
        model.train()
        loss = 0.0
        for (ids, _e, _t), a in zip(rows, adv):
            if not ids:
                continue
            lp = _logprob(model, prompt, ids, device)
            with torch.no_grad():
                lr_ = _logprob(ref, prompt, ids, device)
            kl = (torch.exp(lr_ - lp) - (lr_ - lp) - 1).mean()  # k3 estimator
            loss = loss - float(a) * lp.mean() + beta * kl
        (loss / GROUP).backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        opt.step()
        opt.zero_grad()
        used += 1
    del ref
    return {"groups": used, "mean_reward": sum(rewards) / max(len(rewards), 1)}


def guarded_grpo(model, tokenizer, device: str, gate_fn, seed: int = 0, tolerance: float = 0.002) -> str:
    from sham_selfdev import record
    report = _guarded_grpo(model, tokenizer, device, gate_fn, seed, tolerance)
    record("الاستدلال المتحقَّق (GRPO)", report.split(":", 1)[1].strip())
    return report


def _guarded_grpo(model, tokenizer, device: str, gate_fn, seed: int = 0, tolerance: float = 0.002) -> str:
    """The whole stage: measure → sleep, or train one guarded round."""
    rate = success_rate(model, tokenizer, device, seed=seed)
    if rate < WAKE_AT:
        return (f"🧮 الاستدلال المتحقَّق (GRPO): نائم — إصابة شام في المسائل {rate:.0%} "
                f"(يستيقظ وحده عند {WAKE_AT:.0%}).")
    saved = {n: p.detach().clone() for n, p in model.named_parameters()}
    before = gate_fn(model)
    stats = grpo_round(model, tokenizer, device, seed=seed)
    after = gate_fn(model)
    rate_after = success_rate(model, tokenizer, device, seed=seed + 1)
    if stats["groups"] and after <= before * (1 + tolerance):
        return (f"🧮 الاستدلال المتحقَّق (GRPO): ✅ {stats['groups']} مجموعة — الإصابة {rate:.0%} → {rate_after:.0%}، "
                f"خسارة التحقق {before:.3f} → {after:.3f}")
    with torch.no_grad():
        for n, p in model.named_parameters():
            p.copy_(saved[n])
    return (f"🧮 الاستدلال المتحقَّق (GRPO): ❌ رُفضت الجولة وأُعيدت الأوزان "
            f"(مجموعات مفيدة {stats['groups']}، خسارة التحقق {before:.3f} → {after:.3f})")


if __name__ == "__main__":
    rng = random.Random(0)
    for _ in range(50):
        q, t = make_task(rng)
        assert check(f"الجواب {t}", t) and not check("لا أعرف", t)
    assert check("الناتج ٤٢", "42") and not check("43 وليس 42", "42")

    class Tok:  # character tokenizer for the offline test
        vocab_size = 400
        def encode(self, s): return [ord(c) % 400 for c in s]
        def decode(self, ids): return "".join(chr(i) if i < 400 else "" for i in ids)

    from model import ShamSmall, ShamSmallConfig
    torch.manual_seed(0)
    m = ShamSmall(ShamSmallConfig(vocab_size=42256, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=128))
    rep = guarded_grpo(m, Tok(), "cpu", gate_fn=lambda _m: 1.0)
    assert "نائم" in rep, rep
    WAKE_AT = 0.0  # force the stage awake for the test
    rep = guarded_grpo(m, Tok(), "cpu", gate_fn=lambda _m: 1.0)
    assert "GRPO" in rep and "نائم" not in rep, rep
    before = {n: p.detach().clone() for n, p in m.named_parameters()}
    rep = guarded_grpo(m, Tok(), "cpu", gate_fn=lambda _m, _it=iter([1.0, 2.0]): next(_it))  # worse → restored
    assert "❌" in rep and all(torch.equal(p, before[n]) for n, p in m.named_parameters()), rep
    print(rep)
    print("sham_grpo self-test OK")
