#!/usr/bin/env python3
"""Nova speed probe: what the user waits for, measured through the Studio exactly as the bot calls it (Gradio `chat`, then `job_result` polling).

Per request it prints: time to first token (first text / tool call / thought seen, polled every 2 s), total time, prompt tokens
(total / from cache / read now), prompt-reading time and speed, generated tokens and generation speed.
Reads the real texts the bot sends from START_JSON (scripts/nova-speed/dump-start.ts). Never prints the token.
Env: BASE (Studio gradio_api URL), TOKEN, START_JSON, STEPS (comma list: lite,lite2,full,full2,gen), OUT (json lines file, optional).
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = os.environ["BASE"].rstrip("/")
HDR = {"Authorization": "Bearer " + os.environ["TOKEN"], "content-type": "application/json"}
START = json.load(open(os.environ["START_JSON"]))
OUT = os.environ.get("OUT", "")


def op(req: urllib.request.Request, t: float) -> str:
    for k in range(8):
        try:
            return urllib.request.urlopen(req, timeout=t).read().decode()
        except urllib.error.HTTPError as e:
            print(f"   HTTP {e.code} {req.full_url.rsplit('/', 2)[-2]}", flush=True)
            if e.code not in (429, 502, 503, 504):
                raise
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"   network: {type(e).__name__}", flush=True)
        time.sleep(5 * (k + 1))
    raise SystemExit("the Studio did not answer")


def call(name: str, data: dict) -> dict:
    req = urllib.request.Request(f"{BASE}/call/v2/{name}", json.dumps(data).encode(), HDR)
    ev = json.loads(op(req, 60))["event_id"]
    raw = op(urllib.request.Request(f"{BASE}/call/{name}/{ev}", headers=HDR), 180)
    line = [l for l in raw.splitlines() if l.startswith("data:")][-1]
    out = json.loads(line[5:])
    return json.loads(out[0]) if isinstance(out, list) and out and isinstance(out[0], str) else (out[0] if isinstance(out, list) else out)


def one(label: str, messages: list, tools: list, max_tokens: int) -> dict:
    t0 = time.time()
    r = call("chat", {"messages": json.dumps(messages, ensure_ascii=False), "tools": json.dumps(tools, ensure_ascii=False) if tools else "",
                      "max_tokens": max_tokens, "think": "", "temperature": 0.3, "wait_s": 2})
    job = r.get("job")
    first = None
    last_pf = None
    while True:
        seen = (r.get("total") or 0) > 0 or (r.get("reasoning_len") or 0) > 0 or bool(r.get("tool_calls"))
        if seen and first is None:
            first = time.time() - t0
        pf = r.get("prefill") or {}
        if pf.get("processed") != last_pf and r.get("type") == "pending":
            print(f"   [{label}] {time.time() - t0:6.0f}s prompt {pf.get('processed')}/{pf.get('total')} (cache {pf.get('cache')}) queue {r.get('queue_pos')} phase {r.get('phase')}", flush=True)
            last_pf = pf.get("processed")
        if r.get("type") != "pending" or time.time() - t0 > 2400:
            break
        time.sleep(2)
        r = call("job_result", {"job_id": job, "offset": 0})
    total = time.time() - t0
    tm = r.get("timings") or {}
    pf = r.get("prefill") or {}
    read_now = tm.get("prompt_n") if tm.get("prompt_n") is not None else pf.get("processed")
    p_ms = tm.get("prompt_ms") or pf.get("time_ms")
    res = {"step": label, "status": r.get("type"), "ttft_s": round(first, 1) if first is not None else None, "total_s": round(total, 1),
           "prompt_total": pf.get("total"), "prompt_cached": pf.get("cache"), "prompt_read": read_now,
           "prompt_s": round(p_ms / 1000, 1) if p_ms else None,
           "prompt_tok_s": tm.get("prompt_per_second") or (round(read_now / (p_ms / 1000), 1) if read_now and p_ms else None),
           "gen_tokens": tm.get("predicted_n"), "gen_tok_s": round(tm["predicted_per_second"], 2) if tm.get("predicted_per_second") else None,
           "restored": r.get("slot_restored"), "text": (r.get("text") or "")[:120]}
    print("== " + json.dumps(res, ensure_ascii=False), flush=True)
    if OUT:
        with open(OUT, "a") as f:
            f.write(json.dumps(res, ensure_ascii=False) + "\n")
    return res


def main() -> None:
    st = call("status", {})
    print("status", json.dumps({k: st.get(k) for k in ("phase", "model", "ctx", "threads", "spec", "vision", "uptime_s", "ready_at", "detail", "error", "build", "start_files", "warm")}, ensure_ascii=False), flush=True)
    steps = [s.strip() for s in os.environ.get("STEPS", "lite,lite2,full,full2,gen").split(",") if s.strip()]
    lite_sys = START["lite"]
    full_sys = START["system"]
    tools = START["tools"]
    example = [{"role": "user", "content": "من أنت؟"}, {"role": "assistant", "content": "أنا Nova AI. أكتب الكود وأصنع الصور والفيديو والصوت وأعمل على GitHub وعلى حاسوبي الخاص. كيف أساعدك؟"}]
    stamp = time.strftime("%H%M%S")
    for s in steps:
        if s == "lite":
            one("lite 'hello' (greeting path, no tools)", [{"role": "system", "content": lite_sys}, *example, {"role": "user", "content": f"hello ({stamp})"}], [], 120)
        elif s == "lite2":
            one("lite 'مرحبا' again (warm)", [{"role": "system", "content": lite_sys + "\nThe user writes Arabic: reply in Arabic only (Arabic letters), never in English."}, *example,
                                             {"role": "user", "content": f"مرحبا كيف حالك ({stamp})\n\n(أجب بالعربية فقط.)"}], [], 120)
        elif s == "full":
            one("full start, new conversation (system + tools)", [{"role": "system", "content": full_sys}, {"role": "user", "content": f"hello, what can you do? ({stamp})"}], tools, 120)
        elif s == "full2":
            one("full start, ANOTHER new conversation (shared start reuse)", [{"role": "system", "content": full_sys}, {"role": "user", "content": f"اكتب دالة بايثون تجمع رقمين ({stamp})"}], tools, 200)
        elif s == "gen":
            one("generation speed (same start, ~250 tokens)", [{"role": "system", "content": full_sys}, {"role": "user", "content": f"Explain in about 180 words what a Python decorator is, with a tiny example. Do not call tools. ({stamp})"}], tools, 300)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:  # never a stack trace with a header in it
        print(f"probe failed: {type(exc).__name__}: {str(exc)[:200]}", file=sys.stderr)
        sys.exit(1)
