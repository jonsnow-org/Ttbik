"""Thinking that improves with effort: more attempts, checked by a verifier that is NOT the model (tests, an executor, a file check).
`best_of_n` and `escalate` spend compute only when needed; `rejection_round` turns verified successes into training data (STaR-style) with their pass rates."""
from __future__ import annotations

from typing import Callable


def best_of_n(generate: Callable[[str, int], str], verify: Callable[[str, str], bool], prompt: str, n: int) -> tuple[str | None, int]:
    """Up to n attempts (attempt i gets index i, so a sampler can vary). Returns (first verified answer or None, number of verified attempts seen)."""
    passes, best = 0, None
    for i in range(n):
        r = generate(prompt, i)
        if verify(prompt, r):
            passes += 1
            best = best if best is not None else r
    return best, passes


def rejection_round(generate: Callable[[str, int], str], verify: Callable[[str, str], bool], tasks: list[str], n: int = 4) -> dict:
    """Sample n answers per task; keep the first verified one as a training pair. pass@1 uses the first attempt only."""
    pairs, first, any_ = [], 0, 0
    for t in tasks:
        answers = [generate(t, i) for i in range(n)]
        ok = [a for a in answers if verify(t, a)]
        first += bool(verify(t, answers[0]))
        any_ += bool(ok)
        if ok:
            pairs.append((t, ok[0]))
    m = max(1, len(tasks))
    return {"pairs": pairs, "pass_at_1": first / m, "pass_at_n": any_ / m, "tasks": len(tasks)}


def escalate(levels: list[Callable[[str], str]], verify: Callable[[str, str], bool], task: str) -> tuple[str | None, int]:
    """Cheapest first (e.g. 1 cycle, then 2, then 3, then best-of-n): stop at the first verified answer. Returns (answer or None, level index tried last)."""
    last = -1
    for i, lv in enumerate(levels):
        last = i
        r = lv(task)
        if verify(task, r):
            return r, i
    return None, last
