#!/usr/bin/env python3
"""Turns the owner's own chat-app data export into Sham teacher records (the pool read by sham_sil_bridge.teacher_pairs).

Input: the official export of the owner's account (ChatGPT: Settings -> Data controls -> Export data -> the zip/`conversations.json`), or any JSONL of
{"prompt","target"}. Output: JSONL records (lab teacher format) marked as accepted by the owner (metadata reviewed=true, verification_status=owner_accepted, source=<name>).
Nothing is sent anywhere by this script. The export holds private conversations: it must stay on the notebook and in a PRIVATE dataset, never in the repository.
Filters: single user -> assistant exchanges; no empty/very long texts; no e-mail addresses, phone numbers, keys or tokens (the pair is dropped, not masked); no duplicate prompts.
    python import_chat_export.py EXPORT.json|EXPORT.zip OUT.jsonl [--source chatgpt-export]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path

MAX_PROMPT, MAX_TARGET, MIN_TARGET = 1500, 3000, 2
# a teacher's own name inside an answer would teach Sham a wrong identity ("أنا ChatGPT"): such pairs are dropped
BRAND = re.compile(r"chatgpt|openai|\bgpt-?\d|anthropic|claude|gemini|\bgrok\b|bard|as an ai language model|كنموذج لغوي من|تم تدريبي بواسطة|أنا (?:شات|تشات)", re.I)
PII = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+|\+?\d[\d\s().-]{8,}\d|\b(sk|pk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{16,}|[A-Za-z0-9_-]{40,}|\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b")


def _text(msg: dict) -> str:
    c = (msg or {}).get("content") or {}
    parts = c.get("parts")
    if isinstance(parts, list):
        return "\n".join(p for p in parts if isinstance(p, str)).strip()
    return str(c.get("text") or "").strip()


def conversation_pairs(conv: dict) -> list[tuple[str, str]]:
    """(user, assistant) consecutive exchanges along the conversation's current branch."""
    mapping = conv.get("mapping") or {}
    node, chain = conv.get("current_node"), []
    while node and node in mapping and len(chain) < 10000:
        chain.append(mapping[node])
        node = mapping[node].get("parent")
    chain.reverse()
    msgs = [(n["message"]["author"]["role"], _text(n["message"])) for n in chain if n.get("message") and (n["message"].get("author") or {}).get("role") in ("user", "assistant")]
    pairs = []
    for (r1, t1), (r2, t2) in zip(msgs, msgs[1:]):
        if r1 == "user" and r2 == "assistant":
            pairs.append((t1, t2))
    return pairs


def load_pairs(path: Path) -> list[tuple[str, str]]:
    raw = path.read_bytes()
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as z:
            name = next((n for n in z.namelist() if n.endswith("conversations.json")), None)
            if not name:
                raise SystemExit("no conversations.json in the zip")
            raw = z.read(name)
    text = raw.decode("utf-8")
    if path.suffix.lower() == ".jsonl":
        return [(r["prompt"], r["target"]) for r in (json.loads(l) for l in text.splitlines() if l.strip()) if "prompt" in r and "target" in r]
    data = json.loads(text)
    out: list[tuple[str, str]] = []
    for conv in data if isinstance(data, list) else [data]:
        out.extend(conversation_pairs(conv))
    return out


def clean(pairs: list[tuple[str, str]]) -> tuple[list[tuple[str, str]], dict]:
    seen, out = set(), []
    st = {"in": len(pairs), "empty_or_long": 0, "private": 0, "brand": 0, "duplicate": 0}
    for q, a in pairs:
        q, a = (q or "").strip(), (a or "").strip()
        if not q or len(a) < MIN_TARGET or len(q) > MAX_PROMPT or len(a) > MAX_TARGET:
            st["empty_or_long"] += 1
        elif PII.search(q) or PII.search(a):
            st["private"] += 1
        elif BRAND.search(a):
            st["brand"] += 1
        elif " ".join(q.split()) in seen:
            st["duplicate"] += 1
        else:
            seen.add(" ".join(q.split()))
            out.append((q, a))
    st["out"] = len(out)
    return out, st


def to_records(pairs: list[tuple[str, str]], source: str) -> list[dict]:
    return [{"prompt": q, "target": a, "task": "distilled_sft", "teacher_id": source, "confidence": None, "difficulty": 2, "verifier": "none", "verification": {},
             "metadata": {"reviewed": True, "verification_status": "owner_accepted", "prompt_version": "sil-distill-v1", "source": source}} for q, a in pairs]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--source", default="chatgpt-export")
    a = ap.parse_args(argv)
    pairs, st = clean(load_pairs(Path(a.src)))
    Path(a.out).write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in to_records(pairs, a.source)), encoding="utf-8")
    print(json.dumps(st, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
