"""Lessons memory used at INFERENCE: failures are stored as retrievable lessons ("for tasks like this, `X` did not do it"), verified successes as recipes
("for tasks like this, `Y` did it"). Retrieval is by similarity of the task's template (character trigrams + words of the delexicalised task), so a lesson
learned from one user's wording helps another user's different wording of the same intent. Stdlib only; one store per model (Sham 1 and Sham 2 never share).

    L = LessonStore(path)                         # a JSON file; delete it to forget
    L.add_failure(task, command, why="wrong output")
    L.add_success(task, command)                  # only verifier-confirmed successes
    hits = L.retrieve(task, k=3)                  # [{"kind": "lesson"|"recipe", "command": template, "sim": 0.81, "n": 3}]
    banned = L.banned(task)                       # templates that failed for similar tasks and never succeeded for them
    recipe = L.recipe(task)                       # the best verified template for a very similar task, relexed to this task's arguments, or None
    ctx = L.context(task)                         # a short text for the thinker/compressor input (only when the model was trained with it)

decide(candidates, task): the inference-time use with the writer: candidates = [(command, score)] from best-of-n sampling; banned templates are dropped,
a matching recipe wins ties. Returns the chosen command and why (logged, never silent)."""
from __future__ import annotations

import json
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "data"))
from experience import intent_key, scrub  # noqa: E402


def _grams(s: str) -> Counter:
    s = f"  {s}  "
    c = Counter(s[i:i + 3] for i in range(len(s) - 2))
    c.update("w:" + w for w in s.split())
    return c


def sim(a: str, b: str) -> float:
    ga, gb = _grams(a), _grams(b)
    inter = sum((ga & gb).values())
    return inter / max(1, sum((ga | gb).values()))


def _template(task: str, command: str) -> tuple:
    try:
        import augment as AUG
        _, c, slots = AUG.delex(task, command)
        return c, slots
    except Exception:
        return command, {}


def _relex(template: str, task: str) -> str:
    try:
        import augment as AUG
        _, _, slots = AUG.delex(task)
        return AUG.relex(template, slots)
    except Exception:
        return template


class LessonStore:
    def __init__(self, path: str | None = None, threshold: float = 0.45, recipe_threshold: float = 0.6):
        self.path, self.threshold, self.recipe_threshold = path, threshold, recipe_threshold
        self.items: dict = {}                                       # (key, kind, template) -> {"key","kind","command","n"}
        if path and os.path.exists(path):
            try:
                for it in json.load(open(path, encoding="utf-8")):
                    self.items[(it["key"], it["kind"], it["command"])] = it
            except (OSError, ValueError):
                self.items = {}

    def _add(self, task: str, command: str, kind: str) -> None:
        task = scrub(task)
        tpl, _ = _template(task, scrub(command))
        k = (intent_key(task), kind, tpl)
        it = self.items.setdefault(k, {"key": k[0], "kind": kind, "command": tpl, "n": 0})
        it["n"] += 1

    def add_failure(self, task: str, command: str, why: str = "") -> None:
        self._add(task, command, "lesson")

    def add_success(self, task: str, command: str) -> None:
        self._add(task, command, "recipe")

    def save(self) -> None:
        if self.path:
            os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
            tmp = self.path + ".tmp"
            json.dump(list(self.items.values()), open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
            os.replace(tmp, self.path)

    def retrieve(self, task: str, k: int = 5) -> list:
        key = intent_key(scrub(task))
        scored = [dict(it, sim=round(sim(key, it["key"]), 3)) for it in self.items.values()]
        scored = [s for s in scored if s["sim"] >= self.threshold]
        return sorted(scored, key=lambda s: (-s["sim"], -s["n"]))[:k]

    def banned(self, task: str) -> set:
        hits = self.retrieve(task, k=20)
        ok = {h["command"] for h in hits if h["kind"] == "recipe"}
        return {h["command"] for h in hits if h["kind"] == "lesson" and h["command"] not in ok}

    def recipe(self, task: str):
        hits = [h for h in self.retrieve(task, k=20) if h["kind"] == "recipe" and h["sim"] >= self.recipe_threshold]
        return _relex(hits[0]["command"], task) if hits else None

    def context(self, task: str, k: int = 2) -> str:
        parts = []
        for h in self.retrieve(task, k=k):
            parts.append(("worked: " if h["kind"] == "recipe" else "failed: ") + _relex(h["command"], task))
        return " | ".join(parts)

    def decide(self, candidates: list, task: str) -> tuple:
        """candidates: [(command, score)] best first. -> (command, reason)."""
        ban = self.banned(task)
        rec = self.recipe(task)
        tpl = lambda c: _template(task, c)[0]  # noqa: E731
        if rec is not None and any(c == rec for c, _ in candidates):
            return rec, "recipe (a verified success for a similar task) among the samples"
        for c, _ in candidates:
            if tpl(c) not in ban:
                return c, "best sample not banned by a lesson" if candidates and c != candidates[0][0] else "best sample"
        return candidates[0][0], "every sample was banned by a lesson; kept the best"
