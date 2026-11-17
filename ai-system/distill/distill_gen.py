#!/usr/bin/env python3
"""Sham's distillation network, generator side (design: docs/SHAM_DISTILL.md).

prompts.jsonl  ->  teachers in registry.json  ->  records in the intelligence-lab teacher format, with the lab's own verifiers deciding what passed.
Nothing here trains Sham: records go to quarantine (reviewed=false) and reach training only through sham_sil_bridge (SHAM_SIL_ALLOW_TEACHER=1, reviewed + passed) and the merge gate.

    python distill_gen.py --prompts prompts.jsonl --out records.jsonl [--teachers a,b] [--limit 200]
A prompt row: {"prompt": "...", "task": "reasoning|natural_sft|...", "verifier": "safe_arithmetic|numeric_match|normalized_exact|none", "verification": {...}}
Rules: (1) a teacher must be enabled and of class open (a restricted one also needs owner_approved + SHAM_DISTILL_ALLOW_RESTRICTED=<id>); (2) a record with a verifier is accepted only when the lab verifier passes;
(3) a record WITHOUT a verifier is accepted only when two different teachers agree; otherwise it stays pending in quarantine. Stdlib only; no secrets are read except the key named by key_env.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
LAB_SRC = HERE.parent / "colab" / "sham_small" / "intelligence_lab" / "src"
PROMPT_VERSION = "sil-distill-v1"
BRAND = re.compile(r"chatgpt|openai|\bgpt-?\d|anthropic|claude|gemini|qwen|alibaba|liquid ?ai|llama|\bmeta ai\b|as an ai language model|أنا (?:شات|تشات)", re.I)   # a teacher naming itself would teach Sham a wrong identity


def load_registry(path: Path | None = None) -> dict:
    data = json.loads((path or HERE / "registry.json").read_text(encoding="utf-8"))
    return {t["id"]: t for t in data["teachers"]}


def teacher_allowed(t: dict, env=None) -> tuple[bool, str]:
    env = os.environ if env is None else env
    if not t.get("enabled"):
        return False, "disabled"
    if t.get("class") in ("open", "own"):
        return (True, "") if t.get("endpoint") else (False, "no endpoint")
    if t.get("class") == "restricted":      # terms restrict training on the outputs: only with the owner's explicit switch
        listed = {x.strip() for x in env.get("SHAM_DISTILL_ALLOW_RESTRICTED", "").split(",") if x.strip()}
        if t.get("owner_approved") is True and t["id"] in listed:
            return True, ""
        return False, "restricted source without the owner's switch"
    return False, "not an API teacher (class " + str(t.get("class")) + ")"


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
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return clean_answer(json.loads(r.read().decode())["choices"][0]["message"]["content"])
    except urllib.error.HTTPError as e:     # say WHY (status + a short body) so a wrong model id or key is visible in the log; the key itself is never in the body we print
        body = ""
        try:
            body = e.read().decode("utf-8", "replace")[:160].replace(key, "***") if key else e.read().decode("utf-8", "replace")[:160]
        except Exception:  # noqa: BLE001
            pass
        raise RuntimeError(f"HTTP {e.code} {body}") from None


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
    if status == "passed" and BRAND.search(answer):
        status = "failed"
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
                msg = f"{t['id']}: {type(exc).__name__} {str(exc)[:200]}"
                if msg not in stats.setdefault("errors", []):
                    stats["errors"].append(msg)
        if not answers:
            continue
        if row.get("verifier", "none") not in ("none", ""):
            for t, a in answers:
                rec = make_record(t, row, a, "pending")
                res = verify(rec)
                rec["metadata"]["verification_status"] = "passed" if res.get("passed") is True else "failed"
                stats["passed" if res.get("passed") is True else "failed"] += 1
                out.append(rec)
        elif row.get("accept") == "first":
            t0, a0 = answers[0]                       # open-ended style prompts (explain / code / advice): agreement between free texts is meaningless; one open teacher's answer is taken
            rec = make_record(t0, row, a0, "passed")
            rec["metadata"]["accept_mode"] = "single_teacher"
            stats["passed"] += 1
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


def expand(rows: list[dict], teacher: dict, n: int, ask_fn=ask) -> list[dict]:
    """New prompts: the teacher writes n fresh questions per topic in the style of three examples (self-instruct); the seeds stay in."""
    by: dict[str, list[dict]] = {}
    for r in rows:
        by.setdefault(r.get("topic", ""), []).append(r)
    out = list(rows)
    seen = {" ".join(r["prompt"].split()) for r in rows}
    for topic, group in by.items():
        ex = "\n".join(f"- {g['prompt']}" for g in group[:3])
        try:
            text = ask_fn(teacher, f"اكتب {n} أسئلة عربية جديدة ومتنوعة من النوع نفسه، سؤال واحد في كل سطر، بلا ترقيم ولا شرح:\n{ex}")
        except Exception:
            continue
        for line in text.splitlines():
            q = line.strip().lstrip("-•*0123456789.) ").strip()
            k = " ".join(q.split())
            if 6 <= len(q) <= 300 and k not in seen:
                seen.add(k)
                out.append({**{x: group[0][x] for x in ("task", "topic", "accept") if x in group[0]}, "prompt": q})
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompts", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--teachers", default="")
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--expand", type=int, default=0, help="new questions per topic written by the first teacher")
    a = ap.parse_args(argv)
    reg = load_registry()
    names = [x for x in a.teachers.split(",") if x] or [k for k, v in reg.items() if v.get("enabled")]
    rows = [json.loads(l) for l in Path(a.prompts).read_text(encoding="utf-8").splitlines() if l.strip()][: a.limit]
    chosen = [reg[n] for n in names if n in reg]
    if a.expand:
        first = next((t for t in chosen if teacher_allowed(t)[0]), None)
        if first:
            rows = expand(rows, first, a.expand)
    recs, stats = run(rows[: a.limit * 3], chosen)
    Path(a.out).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in recs), encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
