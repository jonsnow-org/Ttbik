#!/usr/bin/env python3
"""Sham's distillation network, generator side (design: docs/SHAM_DISTILL.md).

prompts.jsonl  ->  teachers in registry.json  ->  records in the intelligence-lab teacher format, with the lab's own verifiers deciding what passed.
Nothing here trains Sham: records go to quarantine (reviewed=false) and reach training only through sham_sil_bridge (SHAM_SIL_ALLOW_TEACHER=1, reviewed + passed) and the merge gate.

    python distill_gen.py --prompts prompts.jsonl --out records.jsonl [--teachers a,b] [--limit 200]
A prompt row: {"prompt": "...", "task": "reasoning|natural_sft|...", "verifier": "safe_arithmetic|numeric_match|normalized_exact|none", "verification": {...}}
Rules: (1) a teacher must be enabled; a commercial one also needs owner_approved + SHAM_DISTILL_ALLOW_COMMERCIAL=<id>; (2) a record with a verifier is accepted only when the lab verifier passes;
(3) a record WITHOUT a verifier is accepted only when two different teachers agree; otherwise it stays pending in quarantine. Stdlib only; no secrets are read except the key named by key_env.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB_SRC = HERE.parent / "colab" / "sham_small" / "intelligence_lab" / "src"
PROMPT_VERSION = "sil-distill-v1"


def load_registry(path: Path | None = None) -> dict:
    data = json.loads((path or HERE / "registry.json").read_text(encoding="utf-8"))
    return {t["id"]: t for t in data["teachers"]}


def teacher_allowed(t: dict, env=None) -> tuple[bool, str]:
    env = os.environ if env is None else env
    if not t.get("enabled"):
        return False, "disabled"
    if t.get("class") == "open":
        return (True, "") if t.get("endpoint") else (False, "no endpoint")
    if t.get("class") == "commercial":
        listed = {x.strip() for x in env.get("SHAM_DISTILL_ALLOW_COMMERCIAL", "").split(",") if x.strip()}
        if t.get("owner_approved") is True and t["id"] in listed:
            return True, ""
        return False, "commercial source without owner approval (policy: no training on commercial-model outputs)"
    return False, "unknown class"


def clean_answer(text: str) -> str:
    return re.sub(r"<think>.*?</think>", "", text or "", flags=re.S).strip()


def ask(t: dict, prompt: str, timeout: int = 180, env=None) -> str:
    env = os.environ if env is None else env
    headers = {"Content-Type": "application/json"}
    key = env.get(t.get("key_env", ""), "") if t.get("key_env") else ""
    if key:
        headers["Authorization"] = "Bearer " + key
    body = json.dumps({"model": t["model"], "messages": [{"role": "user", "content": prompt}], "temperature": 0.2, "max_tokens": 600}).encode()
    req = urllib.request.Request(t["endpoint"], data=body, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return clean_answer(json.loads(r.read().decode())["choices"][0]["message"]["content"])


def _words(s: str) -> set[str]:
    return set(re.findall(r"\w+", s.lower()))


def agree(a: str, b: str, threshold: float = 0.8) -> bool:
    wa, wb = _words(a), _words(b)
    return bool(wa and wb) and len(wa & wb) / len(wa | wb) >= threshold


def verify(rec: dict) -> dict:
    sys.path.insert(0, str(LAB_SRC))
    from sham_intelligence_lab.schema import example_from_teacher
    from sham_intelligence_lab.distillation import verify_example
    ex = example_from_teacher(prompt=rec["prompt"], target=rec["target"], task=rec.get("task", "distilled_sft"), teacher_id=rec["teacher_id"],
                              metadata=rec.get("metadata", {}), verifier=rec.get("verifier", "none"), verification=rec.get("verification", {}))
    return verify_example(ex)


def make_record(t: dict, row: dict, answer: str, status: str) -> dict:
    return {"prompt": row["prompt"], "target": answer, "task": row.get("task", "distilled_sft"), "teacher_id": t["id"], "confidence": None,
            "difficulty": int(row.get("difficulty", 2)), "verifier": row.get("verifier", "none"), "verification": row.get("verification", {}),
            "metadata": {"reviewed": False, "verification_status": status, "model_version": t.get("model", ""), "prompt_version": PROMPT_VERSION,
                         "license": t.get("license", ""), "teacher_class": t.get("class", "")}}


def run(rows: list[dict], teachers: list[dict], ask_fn=ask, env=None) -> tuple[list[dict], dict]:
    usable = []
    stats = {"rows": len(rows), "teachers": [], "refused": {}, "passed": 0, "failed": 0, "pending": 0, "agreed": 0, "disagreed": 0}
    for t in teachers:
        ok, why = teacher_allowed(t, env)
        if ok:
            usable.append(t)
            stats["teachers"].append(t["id"])
        else:
            stats["refused"][t["id"]] = why
    out = []
    for row in rows:
        answers = []
        for t in usable:
            try:
                answers.append((t, ask_fn(t, row["prompt"])))
            except Exception as exc:  # a teacher that is down is skipped, never fatal
                stats.setdefault("errors", []).append(f"{t['id']}: {type(exc).__name__}")
        if not answers:
            continue
        if row.get("verifier", "none") not in ("none", ""):
            for t, a in answers:
                rec = make_record(t, row, a, "pending")
                res = verify(rec)
                rec["metadata"]["verification_status"] = "passed" if res.get("passed") is True else "failed"
                stats["passed" if res.get("passed") is True else "failed"] += 1
                out.append(rec)
        else:
            t0, a0 = answers[0]
            if len(answers) >= 2 and agree(a0, answers[1][1]):
                rec = make_record(t0, row, a0, "passed")
                rec["metadata"]["agreed_with"] = answers[1][0]["id"]
                stats["agreed"] += 1
                stats["passed"] += 1
            else:
                rec = make_record(t0, row, a0, "pending")
                stats["disagreed" if len(answers) >= 2 else "pending"] += 1
            out.append(rec)
    return out, stats


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompts", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--teachers", default="")
    ap.add_argument("--limit", type=int, default=200)
    a = ap.parse_args(argv)
    reg = load_registry()
    names = [x for x in a.teachers.split(",") if x] or [k for k, v in reg.items() if v.get("enabled")]
    rows = [json.loads(l) for l in Path(a.prompts).read_text(encoding="utf-8").splitlines() if l.strip()][: a.limit]
    recs, stats = run(rows, [reg[n] for n in names if n in reg])
    Path(a.out).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in recs), encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
