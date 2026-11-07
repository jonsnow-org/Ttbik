"""
Sham — teaching data for READING EVIDENCE from a library ("تعليم شام قراءة المراجع").

A small model that is only handed retrieved text often ignores it or is misled by it (reported for small models in "Can Small Language Models Use What They
Retrieve?"); it has to be TRAINED to use evidence, including the two cases that matter most:
  - the answer is in one of several passages while the others are distractors  -> copy it exactly;
  - the answer is in none of them                                               -> say so instead of inventing (hallucination control).

No teacher and no labels: from a pile of articles it builds fill-in-the-blank questions (a number or a key word is hidden in a real sentence), asks the
library (sham_kb.KnowledgeBase, BM25) with the sentence, and places the top results in the exact layout Sham already uses for search
(<SEARCH_START> query <SEARCH_END> <RESULT_START> evidence <RESULT_END> answer), so what it learns here is what `ask_web` / a local library gives it at answer
time. The evidence tokens are NOT trained on (labels ignored: they come from the tool); the query and the answer are.

Share of these in the chat-stage mix: SHAM_RAG_MIX (0..1, default 0.06, ON; 0 turns it off).
"""
from __future__ import annotations

import os
import random
import re

from model import SpecialTokens
from sham_decoding import SHAM_TURN, USER_TURN
from sham_kb import KnowledgeBase

IGNORE = -100
ASK = [
    "أكمل الفراغ بالمعلومة الصحيحة من المراجع: {s}",
    "املأ الفراغ ____ اعتمادًا على المراجع: {s}",
    "ما الكلمة أو الرقم الناقص؟ {s}",
]
NO_ANSWER = ["لا أجد الجواب في المراجع التي وصلتني.", "المراجع لا تذكر هذه المعلومة، فلن أخمّن.", "ليس في المراجع ما يجيب عن هذا."]
_NUM = re.compile(r"(?<![\w.])(\d{2,4}|[٠-٩]{2,4})(?![\w.])")
_SENT = re.compile(r"(?<=[.!؟?])\s+|\n+")


def mix_share() -> float:
    try:
        return min(1.0, max(0.0, float(os.environ.get("SHAM_RAG_MIX", "0.06"))))
    except ValueError:
        return 0.0


def _blank_question(text: str, rng: random.Random):
    """A real sentence of the article with one number (preferred) or one long word hidden -> (sentence_with_blank, hidden, sentence)."""
    sents = [s.strip() for s in _SENT.split(text) if 50 <= len(s.strip()) <= 220]
    rng.shuffle(sents)
    for s in sents[:12]:
        nums = _NUM.findall(s)
        if nums:
            h = rng.choice(nums)
            return s.replace(h, "____", 1), h, s
    for s in sents[:12]:
        words = [w for w in re.findall(r"[^\W\d_]{5,}", s)]
        if words:
            h = rng.choice(words[len(words) // 2:])
            return s.replace(h, "____", 1), h, s
    return None


def rag_examples(text_ids_fn, articles: list[tuple[str, str]], rng: random.Random, n: int, max_len: int = 900, evidence_tokens: int = 110,
                 n_results: int = 3, p_no_answer: float = 0.15, kb: KnowledgeBase | None = None) -> list[tuple[list[int], list[int]]]:
    """(ids, labels) in Sham's dialogue layout. `articles` = [(title, text)] — e.g. what the chat stage already loads for its search examples."""
    arts = [(t, x) for t, x in articles if x and len(x) > 200]
    if len(arts) < 4:
        return []
    if kb is None:
        kb = KnowledgeBase().build(x for _, x in arts)
    out: list[tuple[list[int], list[int]]] = []
    tries = 0
    while len(out) < n and tries < n * 6:
        tries += 1
        di = rng.randrange(len(arts))
        pick = _blank_question(arts[di][1], rng)
        if pick is None:
            continue
        blank_s, hidden, sentence = pick
        res = kb.search(sentence.replace(hidden, " "), n_results)            # the query is the sentence WITHOUT its answer
        if not res:
            continue
        gold = [r for r in res if hidden in r[2] and sentence[:40] in r[2]]
        abstain = rng.random() < p_no_answer
        if abstain:
            res = [r for r in res if r not in gold]
            if not res:
                continue
        elif not gold:
            continue
        else:
            rng.shuffle(res)                                                 # the gold passage is not always first
        q = text_ids_fn(rng.choice(ASK).format(s=blank_s))
        query = text_ids_fn(sentence.replace(hidden, " ")[:140])
        evidence = []
        for _, _, txt in res:
            evidence += text_ids_fn(txt)[:evidence_tokens]
        ans = text_ids_fn(rng.choice(NO_ANSWER) if abstain else hidden)
        prefix = [SpecialTokens.BOS, USER_TURN] + q + [SHAM_TURN]
        call = [SpecialTokens.SEARCH_START] + query + [SpecialTokens.SEARCH_END]
        back = [SpecialTokens.RESULT_START] + evidence + [SpecialTokens.RESULT_END]
        ids = prefix + call + back + ans + [SpecialTokens.EOS]
        if len(ids) > max_len:
            continue
        labels = [IGNORE] * len(prefix) + call + [IGNORE] * len(back) + ans + [SpecialTokens.EOS]
        out.append((ids, labels))
    return out


def rag_batches(text_ids_fn, articles, rng: random.Random, n: int, batch_size: int, max_len: int = 900) -> list:
    """Padded batches, or [] when SHAM_RAG_MIX=0 (so a notebook can call it unconditionally)."""
    from sham_chat import batch_examples
    if mix_share() <= 0 or n <= 0:
        return []
    ex = rag_examples(text_ids_fn, articles, rng, n, max_len=max_len)
    return batch_examples(ex, batch_size, seed=rng.randrange(1 << 30)) if ex else []


def _selftest() -> None:
    def ids(text):                              # one id per character: enough to check the layout and the masking
        return [100 + (ord(c) % 5000) for c in text]
    base = ("تأسست المدينة عام 1850 على ضفاف النهر الكبير وكانت مركزا تجاريا مهما للمنطقة كلها. " * 4)
    arts = [(f"مقالة {i}", base.replace("1850", str(1800 + i * 7)) + f" وتشتهر بمصنوعاتها المميزة رقم {i} في الأسواق العالمية. " * 3) for i in range(12)]
    ex = rag_examples(ids, arts, random.Random(0), 40, max_len=2000)
    assert ex, "no examples built"
    gold = abst = 0
    for i, l in ex:
        assert len(i) == len(l)
        assert SpecialTokens.RESULT_START in i and SpecialTokens.RESULT_END in i
        a, b = i.index(SpecialTokens.RESULT_START), i.index(SpecialTokens.RESULT_END)
        assert all(x == IGNORE for x in l[a:b + 1]), "evidence must not be trained on"
        assert l[-1] == SpecialTokens.EOS and any(x != IGNORE for x in l)
        ans = [x for x in l[b + 1:-1]]
        gold += int(len(ans) <= 6)
        abst += int(len(ans) > 6)
    assert gold > 0 and abst > 0, (gold, abst)
    os.environ["SHAM_RAG_MIX"] = "0"
    assert rag_batches(ids, arts, random.Random(0), 10, 4) == []
    print(f"sham_rag_data self-test OK  ({len(ex)} examples: {gold} answerable, {abst} abstain)")


if __name__ == "__main__":
    _selftest()
