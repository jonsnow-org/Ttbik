"""
Sham Pro repeat probe (read-only): asks several DIFFERENT questions through the same calls the bot makes and checks the answers are not the same text.

    python sham_pro_repeat_probe.py        (needs MODELSCOPE_TOKEN; no secret is printed)

Paths: generate_chat (one turn), generate_chat with the conversation so far (what the bot sends), generate_chat_stream with the conversation,
generate_tldm on one session (the owner's T-LDM path). Prints each answer, the time, and the pairwise similarity; exits 1 when two different questions
got (nearly) the same answer on one path.
"""
from __future__ import annotations

import difflib
import json
import os
import sys
import time
import uuid

import requests

BASE = (os.environ.get("SHAM_V2_URL") or "https://studio-novaai2026-sham-v2-server.api-inference.modelscope.net").strip().rstrip("/")
QUESTIONS = ["ما عاصمة فرنسا؟", "اشرح لي التمثيل الضوئي باختصار", "كم يساوي 17 ضرب 3؟", "اكتب بيتاً من الشعر عن البحر", "ما الفرق بين بايثون وجافاسكربت؟"]


def _headers() -> dict:
    return {"Authorization": f"Bearer {os.environ.get('MODELSCOPE_TOKEN', '').strip()}"}


def call(api: str, payload: dict, timeout: float = 240) -> str:
    """All `data:` events of one Gradio call joined (a streamed endpoint yields many pieces; a plain one yields one value)."""
    sub = requests.post(f"{BASE}/gradio_api/call/v2/{api}", headers=_headers(), json=payload, timeout=40)
    sub.raise_for_status()
    eid = sub.json()["event_id"]
    res = requests.get(f"{BASE}/gradio_api/call/{api}/{eid}", headers=_headers(), timeout=timeout, stream=True)
    res.raise_for_status()
    pieces, event = [], ""
    for line in res.iter_lines(decode_unicode=True):
        if not line:
            continue
        if line.startswith("event:"):
            event = line[6:].strip()
            if event in ("complete", "error") and event == "error":
                pieces.append("[gradio error]")
            continue
        if line.startswith("data:") and event != "complete":
            try:
                data = json.loads(line[5:].strip())
            except json.JSONDecodeError:
                continue
            if isinstance(data, list) and data:
                pieces.append(str(data[0]))
        if event == "complete":
            break
    return pieces


def text_of(value) -> str:
    try:
        obj = json.loads(value)
        if isinstance(obj, dict):
            return str(obj.get("text") or obj)
    except (TypeError, ValueError):
        pass
    return str(value)


def ask(path: str, q: str, history: list, session: str) -> str:
    msgs = history + [{"role": "user", "content": q}]
    if path == "chat1":
        out = call("generate_chat", {"messages_json": json.dumps([{"role": "user", "content": q}], ensure_ascii=False), "max_new_tokens": 160, "temperature": 0.6, "think_tokens": 0})
        return text_of(out[-1]) if out else ""
    if path == "chat":
        out = call("generate_chat", {"messages_json": json.dumps(msgs, ensure_ascii=False), "max_new_tokens": 160, "temperature": 0.6, "think_tokens": 0})
        return text_of(out[-1]) if out else ""
    if path == "stream":
        out = call("generate_chat_stream", {"messages_json": json.dumps(msgs, ensure_ascii=False), "max_new_tokens": 160, "temperature": 0.6, "think_tokens": 0})
        # gradio "generating" events of a generator carry the latest yielded piece; a cumulative or per-piece stream both end in the full text
        joined = "".join(out)
        return out[-1] if out and len(out[-1]) >= len(joined) / 2 else joined
    if path == "tldm":
        out = call("generate_tldm", {"messages_json": json.dumps(msgs, ensure_ascii=False), "session": session, "max_new_tokens": 512, "tldm_flag": 1, "owner": 1})
        return text_of(out[-1]) if out else ""
    raise ValueError(path)


def main() -> int:
    if not os.environ.get("MODELSCOPE_TOKEN", "").strip():
        print("no ModelScope token — no probe")
        return 0
    try:
        st = requests.get(f"{BASE}/gradio_api/call/v2/status", headers=_headers(), timeout=5)
    except Exception:
        st = None
    paths = [p.strip() for p in (os.environ.get("PATHS") or "chat1,chat,stream,tldm").split(",") if p.strip()]
    qs = [q.strip() for q in (os.environ.get("ASK") or "").split("|") if q.strip()] or QUESTIONS
    bad = 0
    for path in paths:
        print(f"\n===== {path} =====")
        history: list = []
        answers = []
        session = f"repeat-probe-{uuid.uuid4().hex[:8]}"
        for q in qs:
            t0 = time.time()
            try:
                a = ask(path, q, history, session).strip()
            except Exception as exc:
                a = f"[failed: {type(exc).__name__}: {str(exc)[:160]}]"
            print(f"\nQ: {q}\nA ({time.time() - t0:.0f}s): {a[:400]!r}")
            answers.append(a)
            history += [{"role": "user", "content": q}, {"role": "assistant", "content": a}]
            history = history[-8:]
        for i in range(len(answers)):
            for j in range(i + 1, len(answers)):
                r = difflib.SequenceMatcher(None, answers[i], answers[j]).ratio()
                if r > 0.8 and answers[i]:
                    bad += 1
                    print(f"  REPEAT on {path}: Q{i + 1} vs Q{j + 1} similarity {r:.2f}")
    print(f"\nrepeats: {bad}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
