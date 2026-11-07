"""
Sham — a patient search function for the learned search loop (what Nova's runs taught: one empty search must not end the attempt, and the
whole sentence is a bad query). It wraps any `search_fn(query) -> text` (e.g. sham_decoding.web_search_text):
  - a failing call is retried once;
  - a thin/empty result is retried with the topic only (sham_agent_data.keyword_query), then with a second wording;
  - identical queries are answered from a small cache (no repeated outbound calls);
  - the whole lookup stops at a time budget (SHAM_SEARCH_BUDGET_S, default 20 s) — it never waits for ever.
It never invents text: when nothing is found it returns "" and the caller's own "لا توجد نتائج." is what the model sees — the exact text the
training examples (sham_agent_data, kind "thin") teach it to answer honestly from.
"""

from __future__ import annotations

import os
import time
from typing import Callable

from sham_agent_data import keyword_query

THIN_CHARS = 60
SearchFn = Callable[[str], str]


def agent_search(search_fn: SearchFn, budget_s: float | None = None, clock: Callable[[], float] = time.monotonic) -> SearchFn:
    budget = budget_s if budget_s is not None else float(os.environ.get("SHAM_SEARCH_BUDGET_S", "20"))
    cache: dict[str, str] = {}

    def attempt(q: str) -> str:
        for _ in range(2):
            try:
                return (search_fn(q) or "").strip()
            except Exception:
                continue
        return ""

    def run(query: str) -> str:
        q = " ".join((query or "").split())
        if not q:
            return ""
        if q in cache:
            return cache[q]
        t0 = clock()
        tried, best = [], ""
        topic = keyword_query(q)
        for cand in (q, topic, topic + " ويكيبيديا"):
            if cand in tried or not cand.strip():
                continue
            if tried and clock() - t0 > budget:
                break
            tried.append(cand)
            out = attempt(cand)
            if len(out) > len(best):
                best = out
            if len(best) >= THIN_CHARS:
                break
        cache[q] = best
        return best

    return run


if __name__ == "__main__":
    calls: list[str] = []

    def fake(q: str) -> str:
        calls.append(q)
        return "نتيجة طويلة بما يكفي عن الموضوع المطلوب، " * 3 if q == "مشاريع تلجرام" else ""

    f = agent_search(fake)
    assert f("ابحث لي عن مشاريع تلجرام وأعطني تقريراً").startswith("نتيجة")
    assert calls[0].startswith("ابحث لي") and calls[-1] == "مشاريع تلجرام", calls         # whole sentence first, then the topic
    n = len(calls)
    f("ابحث لي عن مشاريع تلجرام وأعطني تقريراً")
    assert len(calls) == n, "cached query must not search again"

    flaky = {"n": 0}

    def boom(q: str) -> str:
        flaky["n"] += 1
        if flaky["n"] == 1:
            raise RuntimeError("network")
        return "ok " * 40

    assert agent_search(boom)("x y").startswith("ok") and flaky["n"] == 2        # one retry after an exception

    assert agent_search(lambda q: "")("شيء غير موجود") == ""                      # nothing found: empty, never invented
    t = {"v": 0.0}
    slow_calls: list[str] = []

    def slow(q: str) -> str:
        slow_calls.append(q)
        t["v"] += 30
        return ""

    agent_search(slow, budget_s=20, clock=lambda: t["v"])("ابحث لي عن موضوع نادر جدا")
    assert len(slow_calls) == 1, slow_calls      # the first call spent the budget: no further wording is tried
    assert agent_search(lambda q: "x")("") == ""
    print("sham_agent_search OK: retry, topic fallback, cache, time budget, never invents.")
