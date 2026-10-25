#!/usr/bin/env python3
"""Reads Nova's conversation start (real system text + the whole fixed tool list, scripts/nova-eval/base_payload.json) into every coder Studio's prompt cache,
exactly like the bot calls a Studio (Gradio call, then polling), then proves it: a NEW conversation on the same start must read only a few tokens.
The token comes from the environment (T), never printed."""
import json, os, sys, threading, time, urllib.error, urllib.request

P = json.load(open("scripts/nova-eval/base_payload.json"))
HDR = {"Authorization": "Bearer " + os.environ["T"], "content-type": "application/json"}
OUT = {}

def base(n):
    return f"https://studio-novaai2026-coder-inference-server{'' if n == 1 else '-%d' % n}.api-inference.modelscope.net/gradio_api"

def op(req, t):
    for k in range(8):
        try:
            return urllib.request.urlopen(req, timeout=t).read().decode()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 502, 503):
                raise
            time.sleep(6 * (k + 1))
    raise RuntimeError("still refused")

def call(n, name, data):
    req = urllib.request.Request(f"{base(n)}/call/v2/{name}", json.dumps(data).encode(), HDR)
    ev = json.loads(op(req, 60))["event_id"]
    raw = op(urllib.request.Request(f"{base(n)}/call/{name}/{ev}", headers=HDR), 120)
    line = [l for l in raw.splitlines() if l.startswith("data:")][-1]
    return json.loads(json.loads(line[5:])[0])

def ask(n, tools, user, label, log):
    t0 = time.time()
    msgs = [{"role": "system", "content": P["system"]}, {"role": "user", "content": user}]
    r = call(n, "chat", {"messages": json.dumps(msgs), "tools": json.dumps(tools), "max_tokens": 1, "think": "", "temperature": 0.2, "wait_s": 5})
    job = r.get("job")
    while r.get("type") == "pending" and time.time() - t0 < 1500:
        time.sleep(5)
        try:
            r = call(n, "job_result", {"job_id": job, "offset": 0})
        except Exception:
            continue
    pf = r.get("prefill") or {}
    log.append(f"  {label:44s} total {pf.get('total')} | from cache {pf.get('cache')} | read now {(r.get('timings') or {}).get('prompt_n')} | {time.time()-t0:.0f} s | {r.get('type')}")

def one(n):
    log = [f"== Studio {n}"]
    try:
        ask(n, P["full"], ".", "1 base (with connector tools)", log)
        ask(n, P["full_no_connectors"], ".", "2 base (without connector tools)", log)
        ask(n, P["full_no_connectors"], "ما هي عاصمة اليابان؟", "3 NEW conversation, short question", log)
    except Exception as e:
        log.append(f"  failed: {type(e).__name__} {str(e)[:120]}")
    OUT[n] = log

ts = [threading.Thread(target=one, args=(n,)) for n in (int(x) for x in (sys.argv[1:] or ["1", "2", "3", "4", "5"]))]
for t in ts: t.start(); time.sleep(3)
for t in ts: t.join()
for n in sorted(OUT): print("\n".join(OUT[n]), flush=True)
