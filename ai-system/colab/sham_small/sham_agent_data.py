"""
Sham — what Nova's work taught, as TEACHING DATA for Sham's own learned search (no rules that answer for the model).

Nova's live runs showed three failures that the old Sham search examples would also have:
  1. the whole command sentence became the query ("ابحث لي عن X وأعطني تقريراً") instead of the topic — nothing is found;
  2. when nothing is found the model invents a name and answers anyway;
  3. one failed search ends the attempt, with no second try using a different query.
The old example (sham_chat.build_search_example) only ever showed «ما هو X؟ → search X → answer», so none of this was ever taught.
This module builds the missing examples in the SAME token format (<SEARCH_START> query <SEARCH_END> <RESULT_START> result <RESULT_END> answer),
with the same masking: the query and the answer are learned, the result text is not (it comes from the tool at inference).

Kinds (chosen by the caller's rng, shares in KIND_WEIGHTS):
  command : a long, wordy request → a SHORT topic query → the result → a short grounded answer.
  thin    : the search returns nothing («لا توجد نتائج.», the exact text serve's search returns) → an honest "not found, I will not guess".
  retry   : first query finds nothing → a second, different query → the result → the answer.

Also: keyword_query() (the same topic-extraction, used at inference by sham_agent_search.py) and examples_from_lessons() which turns the
owner's Nova "lessons" (coder_lessons export, JSON Lines) into the same examples. Nothing here runs at inference as an answer rule.
Controlled by SHAM_AGENT_SEARCH_MIX (0..1, default 0.5): the share of the existing search examples that use these richer kinds instead.
"""

from __future__ import annotations

import json
import os
import random
import re
from pathlib import Path

from model import SpecialTokens
from sham_decoding import SHAM_TURN, USER_TURN

IGNORE = -100
NO_RESULTS = "لا توجد نتائج."

COMMANDS_AR = [
    "ابحث لي عن {t} وأعطني تقريراً مختصراً.",
    "أريد معلومات عن {t} مع مصادرها.",
    "قم بالبحث عن {t} ولخّص لي أهم ما وجدت.",
    "هل يمكنك أن تبحث في الإنترنت عن {t} وتخبرني؟",
    "ابحث عن {t} واكتب لي خلاصة.",
    "لو سمحت، جد لي معلومات موثوقة عن {t}.",
]
NOT_FOUND_AR = [
    "لم أجد في المصادر ما يكفي عن {t}، ولن أخمّن. جرّب صياغة أخرى أو أعطني اسماً أدق.",
    "بحثت عن {t} ولم أجد نتائج موثوقة، لذلك لا أريد اختراع معلومة.",
    "لا أملك مصادر كافية عن {t}، ولا أستطيع الجزم بشيء دون مصدر.",
]
RETRY_SUFFIX = ["ويكيبيديا", "تعريف", "نبذة"]
KIND_WEIGHTS = (("command", 0.5), ("thin", 0.2), ("retry", 0.3))

_STOP = set("""ابحث لي عن و أريد معلومات مع مصادرها قم بالبحث ولخّص لخص أهم ما وجدت هل يمكنك أن في الإنترنت وتخبرني تخبرني اكتب
خلاصة لو سمحت جد موثوقة تقريراً تقرير مختصراً مختصر أعطني اعطني عن حول بخصوص ماذا تعرف ما هو هي من هو عرّف عرف حدثني
please search for me about find tell give report summary summarize of the a an and on""".split())
_PUNCT = re.compile(r"[\"'«»“”.,;:!?؟،()\[\]{}]")


def keyword_query(question: str, max_words: int = 6) -> str:
    """The topic of a wordy request: command words dropped, punctuation dropped, at most `max_words` words (never empty)."""
    words = [w for w in _PUNCT.sub(" ", question).split() if w]
    kept = [w for w in words if w.strip("وفب") not in _STOP and w not in _STOP]
    return " ".join((kept or words)[:max_words])


def _answer_from(article: str, max_chars: int = 220) -> tuple[str, str]:
    paragraphs = [p.strip() for p in article.split("\n") if len(p.strip()) > 80]
    if not paragraphs:
        return "", ""
    first = paragraphs[0].split(". ")[0].strip()
    return (first if first.endswith(".") else first + ".")[:max_chars], " ".join(paragraphs[:2])


def _pack(text_ids_fn, question: str, steps: list[tuple[str, str]], answer: str, max_result_tokens: int, max_answer_tokens: int,
          date_line: str | None) -> tuple[list[int], list[int]]:
    """steps = [(query, result_text), ...]. Query and answer are learned; results are masked."""
    prefix = [SpecialTokens.BOS, USER_TURN] + text_ids_fn((date_line + "\n" if date_line else "") + question) + [SHAM_TURN]
    ids, labels = list(prefix), [IGNORE] * len(prefix)
    for query, result in steps:
        call = [SpecialTokens.SEARCH_START] + text_ids_fn(query) + [SpecialTokens.SEARCH_END]
        back = [SpecialTokens.RESULT_START] + text_ids_fn(result)[:max_result_tokens] + [SpecialTokens.RESULT_END]
        ids += call + back
        labels += call + [IGNORE] * len(back)
    ans = text_ids_fn(answer)[:max_answer_tokens]
    return ids + ans + [SpecialTokens.EOS], labels + ans + [SpecialTokens.EOS]


def build_agent_search_example(text_ids_fn, title: str, article: str, rng: random.Random, max_result_tokens: int = 160,
                               max_answer_tokens: int = 96, date_line: str | None = None, kind: str | None = None):
    """One richer search example from a (title, article) pair, or None when the article has no usable text."""
    answer, result = _answer_from(article)
    title = (title or "").strip()
    if not title or not answer:
        return None
    kind = kind or rng.choices([k for k, _ in KIND_WEIGHTS], [w for _, w in KIND_WEIGHTS])[0]
    question = rng.choice(COMMANDS_AR).format(t=title)
    if kind == "thin":
        return _pack(text_ids_fn, question, [(title, NO_RESULTS)], rng.choice(NOT_FOUND_AR).format(t=title), max_result_tokens, max_answer_tokens, date_line)
    if kind == "retry":
        return _pack(text_ids_fn, question, [(title + " " + rng.choice(RETRY_SUFFIX) + " xx", NO_RESULTS), (title, result)], answer, max_result_tokens, max_answer_tokens, date_line)
    return _pack(text_ids_fn, question, [(title, result)], answer, max_result_tokens, max_answer_tokens, date_line)


def mix_share() -> float:
    try:
        return min(1.0, max(0.0, float(os.environ.get("SHAM_AGENT_SEARCH_MIX", "0.5"))))
    except ValueError:
        return 0.5


def examples_from_lessons(path: str | Path, text_ids_fn, limit: int = 2000, max_result_tokens: int = 160, max_answer_tokens: int = 96) -> list[tuple[list[int], list[int]]]:
    """The owner's Nova research lessons (JSON Lines, the coder_lessons export) as search examples: the user's request, the first drafted
    query, the research result (masked), the opening of Nova's report as the answer. Lessons that are not research are skipped."""
    out: list[tuple[list[int], list[int]]] = []
    p = Path(path)
    if not p.is_file():
        return out
    for line in p.read_text(encoding="utf-8").splitlines():
        if len(out) >= limit:
            break
        try:
            les = json.loads(line)
        except ValueError:
            continue
        if les.get("kind") != "research":
            continue
        msgs = les.get("messages") or []
        user = next((m for m in msgs if m.get("role") == "user" and str(m.get("content", "")).strip()), None)
        tool = next((m for m in msgs if m.get("role") == "tool" and len(str(m.get("content", ""))) > 80), None)
        final = next((m for m in reversed(msgs) if m.get("role") == "assistant" and len(str(m.get("content", "")).strip()) >= 80), None)
        if not (user and tool and final):
            continue
        query = ""
        for m in msgs:
            for c in m.get("tool_calls") or []:
                try:
                    a = json.loads(c.get("function", {}).get("arguments") or "{}")
                except ValueError:
                    continue
                qs = a.get("queries")
                query = (qs[0] if isinstance(qs, list) and qs else a.get("query") or "") if not query else query
        question = str(user["content"]).strip()[:300]
        answer = re.split(r"(?<=[.!؟?])\s", str(final["content"]).strip(), maxsplit=3)
        out.append(_pack(text_ids_fn, question, [((query or keyword_query(question))[:120], str(tool["content"]))], " ".join(answer[:3])[:420], max_result_tokens, max_answer_tokens, None))
    return out


if __name__ == "__main__":
    import tempfile

    assert keyword_query("ابحث لي عن مشاريع تلجرام بوت على GitHub وأعطني تقريراً مختصراً.") == "مشاريع تلجرام بوت على GitHub", keyword_query("ابحث لي عن مشاريع تلجرام بوت على GitHub وأعطني تقريراً مختصراً.")
    assert keyword_query("tell me about quantum computing") == "quantum computing"
    assert keyword_query("ابحث") == "ابحث"                              # never empty
    assert len(keyword_query("كلمة " * 30).split()) <= 6

    enc = lambda s: [(ord(c) % 200) + 10 for c in s]                    # stand-in for the real tokenizer: one id per character
    art = "دمشق عاصمة سوريا وأقدم مدينة مأهولة في العالم. " * 3 + "\nفقرة ثانية طويلة بما يكفي لتكون مفيدة في هذا الاختبار البسيط جداً."
    rng = random.Random(0)
    for kind in ("command", "thin", "retry"):
        ids, lab = build_agent_search_example(enc, "دمشق", art, rng, kind=kind)
        assert len(ids) == len(lab) and ids[-1] == SpecialTokens.EOS and lab[-1] == SpecialTokens.EOS
        starts = [i for i, t in enumerate(ids) if t == SpecialTokens.SEARCH_START]
        ends = [i for i, t in enumerate(ids) if t == SpecialTokens.SEARCH_END]
        r0 = [i for i, t in enumerate(ids) if t == SpecialTokens.RESULT_START]
        r1 = [i for i, t in enumerate(ids) if t == SpecialTokens.RESULT_END]
        assert len(starts) == len(ends) == len(r0) == len(r1) == (2 if kind == "retry" else 1), kind
        for a, b in zip(r0, r1):
            assert all(lab[i] == IGNORE for i in range(a, b + 1)), "result text must be masked"
        for a, b in zip(starts, ends):
            assert all(lab[i] == ids[i] for i in range(a, b + 1)), "the query must be learned"
        assert all(l == IGNORE for l in lab[: starts[0]]), "the prompt is not learned"
        q_ids = ids[starts[0] + 1 : ends[0]]
        assert len(q_ids) <= 40, "the query must be short, not the whole command"
    assert build_agent_search_example(enc, "", art, rng) is None and build_agent_search_example(enc, "x", "قصير", rng) is None
    thin_ids, _ = build_agent_search_example(enc, "دمشق", art, rng, kind="thin")
    assert enc(NO_RESULTS)[0] in thin_ids

    with tempfile.TemporaryDirectory() as d:
        f = Path(d) / "lessons.jsonl"
        lesson = {"kind": "research", "run": "r1", "steps": 3, "messages": [
            {"role": "user", "content": "ابحث لي عن مشاريع GitHub لبوتات تلجرام وأعطني تقريراً"},
            {"role": "assistant", "content": "", "tool_calls": [{"id": "1", "type": "function", "function": {"name": "deep_research", "arguments": json.dumps({"queries": ["telegram bot github"]})}}]},
            {"role": "tool", "content": "المصدر الأول: مستودع لبوتات تلجرام " * 8},
            {"role": "assistant", "content": "وجدت عدة مشاريع مفيدة. أولها مستودع كبير للبوتات. ثانيها مكتبة سريعة. ثالثها قالب جاهز للاستضافة المجانية."}]}
        f.write_text(json.dumps(lesson, ensure_ascii=False) + "\n" + json.dumps({"kind": "chat", "messages": []}) + "\nnot json\n", encoding="utf-8")
        ex = examples_from_lessons(f, enc)
        assert len(ex) == 1 and ex[0][0].count(SpecialTokens.SEARCH_START) == 1
        assert examples_from_lessons(Path(d) / "missing.jsonl", enc) == []
    os.environ["SHAM_AGENT_SEARCH_MIX"] = "2"
    assert mix_share() == 1.0
    os.environ["SHAM_AGENT_SEARCH_MIX"] = "bad"
    assert mix_share() == 0.5
    print("sham_agent_data OK: short queries, honest 'not found', retry with a different query, masks correct, Nova lessons convert.")
