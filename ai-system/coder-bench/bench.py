"""Read-only latency measurement of the coder Studios (no secrets printed). Times one tiny and one real-size bot turn per Studio."""
import json, os, time, urllib.request
T = os.environ["T"]; MS = "https://www.modelscope.cn"
H = {"Authorization": f"Bearer {T}", "Content-Type": "application/json"}
STUDIOS = os.environ.get("STUDIOS", "coder-inference-server,coder-inference-server-2").split(",")
MODE = os.environ.get("MODE", "full")

def req(url, data=None, timeout=120):
    r = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, headers=H)
    return urllib.request.urlopen(r, timeout=timeout).read().decode()

def call(base, api, payload, timeout=120):
    eid = json.loads(req(f"{base}/gradio_api/call/v2/{api}", payload, timeout))["event_id"]
    body = req(f"{base}/gradio_api/call/{api}/{eid}", None, timeout)
    for l in body.split("\n"):
        if l.startswith("data:"):
            d = json.loads(l[5:])
            if d and d[0]:
                return json.loads(d[0]) if isinstance(d[0], str) else d[0]
    return {"raw": body[:300]}

def run(base, name, msgs, tools, max_tokens=0, think=""):
    t0 = time.time()
    r = call(base, "chat", {"messages": json.dumps(msgs), "tools": json.dumps(tools) if tools else "", "max_tokens": max_tokens, "think": think, "temperature": 0.6, "wait_s": 1})
    t_sub = time.time() - t0
    job = r.get("job"); first = None; qpos = []
    while r.get("type") == "pending":
        time.sleep(1)
        r = call(base, "job_result", {"job_id": job, "offset": 0})
        qpos.append(r.get("queue_pos"))
        if first is None and (r.get("total") or r.get("reasoning_len")):
            first = time.time() - t0
    tot = time.time() - t0
    tm = r.get("timings") or {}
    gen = (tm.get("predicted_n") or 0) / (tm.get("predicted_per_second") or 1e9)
    print(json.dumps({"test": name, "type": r.get("type"), "submit_s": round(t_sub, 1), "first_output_s": first and round(first, 1), "total_s": round(tot, 1),
                      "prompt_n": tm.get("prompt_n"), "predicted_n": tm.get("predicted_n"), "gen_tok_s": tm.get("predicted_per_second") and round(tm["predicted_per_second"], 2),
                      "gen_s": round(gen, 1), "prompt_s_est": round(tot - gen, 1), "prompt_tok_s_est": tm.get("prompt_n") and round(tm["prompt_n"] / max(0.1, tot - gen), 1),
                      "max_queue_pos": max([q for q in qpos if isinstance(q, int)] or [0]), "text": (r.get("text") or "")[:160], "err": r.get("error")}, ensure_ascii=False), flush=True)

turn = json.load(open(os.path.join(os.path.dirname(__file__), "turn_owner.json")))
for s in STUDIOS:
    base = f"https://studio-novaai2026-{s}.api-inference.modelscope.net"
    print(f"===== {s}", flush=True)
    try:
        info = json.loads(req(f"{MS}/openapi/v1/studios/novaai2026/{s}"))
        d = info.get("data") or {}
        print("studio:", json.dumps({k: d.get(k) for k in ("hardware", "status", "sdk_type", "sdk_version", "visibility")} | {"runtime": d.get("runtime")}, ensure_ascii=False)[:800])
    except Exception as e:
        print("studio info err", e)
    try:
        t0 = time.time(); st = call(base, "status", {}); print("status:", json.dumps(st)[:700], f"({time.time()-t0:.1f}s)")
    except Exception as e:
        print("status err", e); continue
    try:
        logs = req(f"{MS}/openapi/v1/studios/novaai2026/{s}/logs/run")
        lines = [l for l in logs.replace("\\n", "\n").split("\n") if "[coder]" in l or "cpu" in l.lower() or "thread" in l.lower()]
        print("run log:", "\n".join(lines[-15:])[:2500])
    except Exception as e:
        print("logs err", e)
    tests = [("tiny_no_tools", [{"role": "user", "content": "مرحبا"}], None, 24)]
    if MODE == "full":
        tests += [("real_turn_owner_tools_40", [{"role": "system", "content": turn["sys"]}, {"role": "user", "content": "من انت"}], turn["tools"], 0),
                  ("same_system_no_tools", [{"role": "system", "content": turn["sys"]}, {"role": "user", "content": "من انت"}], None, 0)]
    for name, m, tl, mx in tests:
        try:
            run(base, name, m, tl, mx)
        except Exception as e:
            print(name, "err", e)
