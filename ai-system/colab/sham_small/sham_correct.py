"""
Sham's learned self-correction ("التصحيح الذاتي المتعلَّم").

Not a draft→critique→fix prompt chain run at answer time (three times slower,
and a young model critiques in noise). Instead Sham is TRAINED to repair:
a correct answer from real data is damaged with the very mistakes Sham makes
in the bot, and Sham learns to write the correct answer after its own
damaged draft:

    <BOS> <USER> question <SHAM> damaged draft <REVISE> correct answer <EOS>
                                                        └─ labels only here

Damage kinds (all taken from what the owner saw in the bot):
  loop       a phrase repeated over and over
  invented   words with shuffled letters (made-up words)
  cut        the answer stops mid-sentence
  dropped    words missing here and there
  off_topic  the answer to a DIFFERENT question

<REVISE> is the last free special id (base + 15). When the measured gain is
real (answer loss after a damaged draft approaches the loss with no draft),
the bot can let Sham revise its own first draft — a learned step, no rules.
"""

from __future__ import annotations

import random

import torch

from model import SpecialTokens
from sham_decoding import SHAM_TURN, USER_TURN

REVISE = SpecialTokens._base + 15
_taken = {v for k, v in vars(SpecialTokens).items() if k.isupper() and isinstance(v, int)}
assert REVISE not in _taken | {USER_TURN, SHAM_TURN}, "REVISE id already used"
assert REVISE < SpecialTokens._base + 16
IGNORE = -100
KINDS = ("loop", "invented", "cut", "dropped", "off_topic")


def _shuffle_word(w: str, rng: random.Random) -> str:
    if len(w) < 4:
        return w
    mid = list(w[1:-1])
    rng.shuffle(mid)
    return w[0] + "".join(mid) + w[-1]


def damage(answer: str, other_answer: str, kind: str, rng: random.Random) -> str:
    words = answer.split()
    if not words:
        return answer
    if kind == "loop":
        k = rng.randint(1, min(4, len(words)))
        start = rng.randint(0, len(words) - k)
        phrase = words[start:start + k]
        return " ".join(words[:start + k] + phrase * rng.randint(3, 6))
    if kind == "invented":
        return " ".join(_shuffle_word(w, rng) if rng.random() < 0.4 else w for w in words)
    if kind == "cut":
        return " ".join(words[:max(1, int(len(words) * rng.uniform(0.2, 0.6)))])
    if kind == "dropped":
        kept = [w for w in words if rng.random() > 0.3]
        return " ".join(kept or words[:1])
    return other_answer  # off_topic


def build_correction_example(encode, question: str, answer: str, other_answer: str, rng: random.Random,
                             max_len: int = 512, max_user: int = 160, max_draft: int = 160):
    kind = rng.choice(KINDS)
    draft = damage(answer, other_answer, kind, rng)
    if draft.strip() == answer.strip():
        return None
    q, d, a = encode(question)[:max_user], encode(draft)[:max_draft], encode(answer)
    prefix = [SpecialTokens.BOS, USER_TURN] + q + [SHAM_TURN] + d + [REVISE]
    a = a[:max(max_len - len(prefix) - 1, 0)]
    if not a:
        return None
    return prefix + a + [SpecialTokens.EOS], [IGNORE] * len(prefix) + a + [SpecialTokens.EOS]


def correction_examples(encode, dialogues: list[tuple[str, str]], share: float = 0.25, seed: int = 0,
                        max_len: int = 512) -> list:
    """One correction example for `share` of the dialogues (a different
    question's answer serves as the off-topic draft)."""
    rng = random.Random(seed)
    if len(dialogues) < 2:
        return []
    picked = rng.sample(range(len(dialogues)), max(1, int(len(dialogues) * share)))
    out = []
    for i in picked:
        q, a = dialogues[i]
        other = dialogues[(i + rng.randint(1, len(dialogues) - 1)) % len(dialogues)][1]
        ex = build_correction_example(encode, q, a, other, rng, max_len=max_len)
        if ex:
            out.append(ex)
    return out


@torch.no_grad()
def revision_gain(model, encode, dialogues, device: str, seed: int = 0) -> dict:
    """Answer loss (a) with no draft, (b) after a damaged draft + <REVISE>.
    b close to (or below) a = Sham has learned to recover from its own
    mistakes. Printed each session; also decides when the bot may revise."""
    from sham_chat import build_chat_example, pad_batch
    from sham_media_link import _loss

    rng = random.Random(seed)
    plain, fixed = [], []
    for i, (q, a) in enumerate(dialogues):
        other = dialogues[(i + 1) % len(dialogues)][1]
        ex = build_correction_example(encode, q, a, other, rng)
        if ex:
            fixed.append(ex)
            plain.append(build_chat_example(encode(q), encode(a)))
    if not fixed:
        return {}
    return {"plain": _loss(model, plain, device), "after_draft": _loss(model, fixed, device)}


def format_gain(g: dict) -> str:
    from sham_selfdev import record
    if not g:
        record("التصحيح الذاتي", "لا أمثلة قياس")
        return "✍️ التصحيح الذاتي: لا أمثلة قياس."
    record("التصحيح الذاتي", f"خسارة الإجابة بلا مسودة {g['plain']:.3f} | بعد مسودة معطوبة + مراجعة {g['after_draft']:.3f}")
    return (f"✍️ التصحيح الذاتي: خسارة الإجابة بلا مسودة {g['plain']:.3f} | "
            f"بعد مسودة معطوبة + مراجعة {g['after_draft']:.3f}")


if __name__ == "__main__":
    rng = random.Random(1)
    ans = "دمشق هي عاصمة سوريا وأقدم مدينة مأهولة في العالم"
    for k in KINDS:
        d = damage(ans, "القطط حيوانات أليفة", k, rng)
        assert d != ans, k
    enc = lambda s: [ord(c) % 1000 for c in s]
    ex = build_correction_example(enc, "ما عاصمة سوريا؟", ans, "القطط", rng)
    ids, labels = ex
    r = ids.index(REVISE)
    assert all(l == IGNORE for l in labels[:r + 1]) and labels[r + 1:] == ids[r + 1:]
    assert labels[-1] == SpecialTokens.EOS
    ds = [(f"سؤال {i}", f"جواب طويل رقم {i} عن موضوع مختلف تماما") for i in range(20)]
    exs = correction_examples(enc, ds, share=0.5, seed=3)
    assert 5 <= len(exs) <= 10
    from model import ShamSmall, ShamSmallConfig
    m = ShamSmall(ShamSmallConfig(vocab_size=42256, d_model=32, n_layers=1, n_heads=2, n_kv_heads=1, mlp_hidden=64, max_seq_len=512))
    g = revision_gain(m, enc, ds[:4], "cpu")
    assert set(g) == {"plain", "after_draft"}
    print(format_gain(g))
    print("sham_correct self-test OK")
