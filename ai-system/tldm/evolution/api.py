"""The calls other workers make (stdlib only; safe to import in the serving path).

Serving (bot / app, after the verifier has judged a finished command; one call per command):
    from evolution.api import record, hints
    record(root, model_id="sham2-tldm", user=session_user, task=user_text, command=cmd, exit_code=rc, stdout=out, stderr=err,
           verdict=verifier_ok, latency_s=dt, adapter=active_adapter, names=(display_name,))
    h = hints(root, "sham2-tldm", task)   # {"recipe": cmd|None, "banned": [...], "context": "..."}: optional inference help (lessons memory)

Studio / trainer cycle (training side):
    from evolution.api import training_pairs
    pairs, why = training_pairs(root, "sham2-tldm", min_consensus=2)   # [(task, command, family)] admitted for TRAINING + why the rest was not
    python eval/self_evolution_benchmark.py ...        (writer: users + curriculum + web, per-family adapters, gate)
    python eval/self_evolution_loop_benchmark.py ...   (agent loop: multi-step, full-task benchmark)

Layout: <root>/<model_id>/experience/<day>.jsonl and <root>/<model_id>/lessons.json. One store per MODEL (Sham 1 and Sham 2 never share, no routing
between models); users are pooled AFTER anonymisation (commercial rule 2026-11-18: the model learns from every user's verified successes, no personal data).
Nothing here limits what the model may do at work time; it only decides what may be LEARNED."""
from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import experience as EX  # noqa: E402
import lessons as LS  # noqa: E402

_LOGS: dict = {}


def _dir(root: str, model_id: str) -> str:
    return os.path.join(root, re.sub(r"[^A-Za-z0-9_.-]", "_", model_id or "default"))


def _log(root: str, model_id: str) -> EX.ExperienceLog:
    k = (root, model_id)
    if k not in _LOGS:
        _LOGS[k] = EX.ExperienceLog(os.path.join(_dir(root, model_id), "experience"))
    return _LOGS[k]


def record(root: str, model_id: str, user: str, task: str, command: str, exit_code: int, stdout: str = "", stderr: str = "", verdict=None,
           latency_s: float = 0.0, adapter: str = "base", names: tuple = (), source: str = "user") -> str:
    """-> "added" | "duplicate" | "rate_limited" | "rejected:...". verdict: True/False from the VERIFIER (None = unknown; stored, never learned).
    source="owner" tags the record as owner-trusted (skip user intake filters at admission; no per-user rate limit)."""
    rec = EX.make_record(user, task, command, exit_code, stdout, stderr, verdict, latency_s, model=model_id, adapter=adapter, source=source, names=names)
    st = _log(root, model_id).add(rec)
    if st == "added" and verdict in (True, False):
        L = LS.LessonStore(os.path.join(_dir(root, model_id), "lessons.json"))
        (L.add_success if verdict else L.add_failure)(rec["intent"], rec["command"])
        L.save()
    return st


def hints(root: str, model_id: str, task: str) -> dict:
    L = LS.LessonStore(os.path.join(_dir(root, model_id), "lessons.json"))
    return {"recipe": L.recipe(task), "banned": sorted(L.banned(task)), "context": L.context(task)}


def training_pairs(root: str, model_id: str, min_consensus: int = 2):
    return _log(root, model_id).admitted(min_consensus, return_reasons=True)
