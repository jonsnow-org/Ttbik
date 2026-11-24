"""Sham Pro (sham-v2-server) live probe: the SAME path the bot takes for every message, timed.

    MODELSCOPE_TOKEN=... python sham_pro_probe.py            (no secret is printed)

Bot path (src/lib/shamAgent.ts): generate_tldm first (the head decides: command / tool / nothing); when the head ran nothing,
the body speaks the answer through generate_chat (or generate_chat_stream in the live app). This prints, per prompt:
the head's time + decision, the body's time + answer, the stream's time-to-first-piece and pieces/s, and whether a
NON-identity prompt still announced «شام برو» (the owner's bug). Read-only: no command needing approval is sent.
"""
from __future__ import annotations

import json
import os
import sys
import time

import requests

BASE = (os.environ.get("SHAM_V2_URL") or "https://studio-novaai2026-sham-v2-server.api-inference.modelscope.net").split(",")[0].strip().rstrip("/")
IDENTITY_Q = {"من أنت؟", "ما اسمك؟", "Who are you?"}
PROMPTS = [
    "مرحبا",
    "ما عاصمة سوريا؟",
    "اكتب دالة بايثون تعيد مضروب عدد.",
    "كم يساوي 17 ضرب 23؟",
    "اشرح باختصار ما هو التعلم الآلي.",
    "What is the capital of Japan?",
    "اعرض الملفات في المجلد الحالي على حاسوبك.",
    "من أنت؟",
    "Who are you?",
]
NAME = ("شام برو", "sham pro")


def _headers() -> dict:
    tok = (os.environ.get("MODELSCOPE_TOKEN") or os.environ.get("MODELSCOPE_API_TOKEN") or "").strip()
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


def call(api: str, payload: dict, timeout: float = 240.0, stream: bool = False):
    """-> (text_of_first_data_value | list_of_pieces, seconds, ttfp)."""
    t0 = time.time()
    sub = requests.post(f"{BASE}/gradio_api/call/v2/{api}", headers=_headers(), json=payload, timeout=60)
    sub.raise_for_status()
    eid = sub.json()["event_id"]
    res = requests.get(f"{BASE}/gradio_api/call/{api}/{eid}", headers=_headers(), timeout=timeout, stream=True)
    pieces, first, event = [], None, ""
    for raw in res.iter_lines(decode_unicode=True):
        if raw is None:
            continue
        if raw.startswith("event:"):
            event = raw[6:].strip()
            if event in ("complete", "error") and not stream and pieces:
                break
            continue
        if not raw.startswith("data:"):
            continue
        try:
            data = json.loads(raw[5:].strip())
        except Exception:
            continue
        if isinstance(data, list) and data and data[0] is not None:
            if first is None:
                first = time.time() - t0
            pieces.append(str(data[0]))
            if not stream:
                break
        if event in ("complete", "error"):
            break
    res.close()
    return (pieces if stream else (pieces[0] if pieces else "")), time.time() - t0, first


def _j(s: str) -> dict:
    try:
        o = json.loads(s)
        return o if isinstance(o, dict) else {"type": "raw", "text": str(o)}
    except Exception:
        return {"type": "raw", "text": s}


def main() -> int:
    if not (os.environ.get("MODELSCOPE_TOKEN") or os.environ.get("MODELSCOPE_API_TOKEN") or "").strip():
        print("no ModelScope token: nothing probed")
        return 0
    try:
        st, secs, _ = call("status", {}, timeout=60)
        print(f"status ({secs:.1f}s):", st[:2500])
    except Exception as exc:
        print("status failed:", type(exc).__name__, str(exc)[:200])
    report = []
    only = os.environ.get("PROBE_ONLY", "").strip()
    prompts = [p.strip() for p in only.split("|") if p.strip()] if only else PROMPTS
    for q in prompts:
        msgs = json.dumps([{"role": "user", "content": q}], ensure_ascii=False)
        row = {"q": q}
        try:
            out, secs, _ = call("generate_tldm", {"messages_json": msgs, "session": "probe-" + str(int(time.time())), "max_new_tokens": 512, "tldm_flag": 1, "owner": 0, "deny_list": "rm -rf /"})
            o = _j(out)
            row.update(head_s=round(secs, 2), head_type=o.get("type"), head_text=str(o.get("text") or "")[:300], head_steps=o.get("computer_steps") or [])
        except Exception as exc:
            row.update(head_s=None, head_type="exception", head_text=f"{type(exc).__name__}: {str(exc)[:200]}")
        try:
            out, secs, _ = call("generate_chat", {"messages_json": msgs, "max_new_tokens": 384, "temperature": 0.6, "think_tokens": 0})
            o = _j(out)
            row.update(body_s=round(secs, 2), body_type=o.get("type"), body_text=str(o.get("text") or "")[:600])
        except Exception as exc:
            row.update(body_s=None, body_type="exception", body_text=f"{type(exc).__name__}: {str(exc)[:200]}")
        try:
            pieces, secs, first = call("generate_chat_stream", {"messages_json": msgs, "max_new_tokens": 256, "temperature": 0.6, "think_tokens": 0}, stream=True)
            text = pieces[-1] if pieces else ""
            row.update(stream_total_s=round(secs, 2), stream_ttfp_s=round(first, 2) if first is not None else None, stream_pieces=len(pieces),
                       stream_chars=len(text), stream_chars_per_s=round(len(text) / max(0.01, secs - (first or 0)), 1) if text else 0)
        except Exception as exc:
            row.update(stream_total_s=None, stream_err=f"{type(exc).__name__}: {str(exc)[:200]}")
        said = (row.get("body_text") or "").lower()
        row["names_itself"] = any(n in said for n in NAME)
        row["identity_prompt"] = q in IDENTITY_Q
        report.append(row)
        print("\n" + json.dumps(row, ensure_ascii=False))
    leaks = [r["q"] for r in report if r["names_itself"] and not r["identity_prompt"]]
    hs = [r["head_s"] for r in report if r.get("head_s")]
    bs = [r["body_s"] for r in report if r.get("body_s")]
    tt = [r["stream_ttfp_s"] for r in report if r.get("stream_ttfp_s")]
    summary = {"prompts": len(report), "identity_leaks_on_other_prompts": leaks,
               "head_mean_s": round(sum(hs) / len(hs), 2) if hs else None, "body_mean_s": round(sum(bs) / len(bs), 2) if bs else None,
               "bot_path_mean_s": round((sum(hs) + sum(bs)) / max(1, len(bs)), 2) if hs and bs else None,
               "stream_ttfp_mean_s": round(sum(tt) / len(tt), 2) if tt else None}
    print("\nSUMMARY", json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
