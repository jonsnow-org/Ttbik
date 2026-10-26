#!/usr/bin/env python3
"""Asks one coder Studio to measure its own prompt-reading speed twice (llama-bench pp512): with all CPU backends (the box has AMX), and with the Sapphire Rapids / AMX backend removed.
Starts the measurement with the Studio's `bench` call, then polls `status` until the answer is there. The Studio must be idle. Token from env T, never printed."""
import json, os, sys, time, urllib.error, urllib.request

n = sys.argv[1] if len(sys.argv) > 1 else "2"
base = f"https://studio-novaai2026-coder-inference-server{'' if n == '1' else '-' + n}.api-inference.modelscope.net/gradio_api"
H = {"Authorization": "Bearer " + os.environ["T"], "content-type": "application/json"}

def op(req, t):
    for k in range(8):
        try:
            return urllib.request.urlopen(req, timeout=t).read().decode()
        except urllib.error.HTTPError as e:
            if e.code not in (429, 502, 503):
                raise
            time.sleep(6 * (k + 1))
    raise RuntimeError("still refused")

def call(name, data):
    ev = json.loads(op(urllib.request.Request(f"{base}/call/v2/{name}", json.dumps(data).encode(), H), 60))["event_id"]
    raw = op(urllib.request.Request(f"{base}/call/{name}/{ev}", headers=H), 120)
    line = [l for l in raw.splitlines() if l.startswith("data:")][-1]
    return json.loads(json.loads(line[5:])[0])

st = call("status", {})
print("Studio", n, "| cpu:", st.get("cpu"), "| flags:", " ".join(f for f in st.get("cpu_flags", []) if f.startswith(("amx", "avx512_vnni", "avx512_bf16"))), "| queue", st.get("queue"), flush=True)
print("start:", call("bench", {}), flush=True)
t0 = time.time()
while time.time() - t0 < 900:
    time.sleep(10)
    try:
        st = call("status", {})
    except Exception as e:
        print("  (status", type(e).__name__, ")", flush=True); continue
    if st.get("bench"):
        for line in st["bench"]:
            print(line, flush=True)
        break
else:
    print("no answer within 15 minutes")
