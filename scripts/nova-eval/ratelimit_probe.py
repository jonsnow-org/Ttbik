#!/usr/bin/env python3
"""How does the hub rate-limit the Studios' address? Sends the cheap `status` call at different speeds and prints the HTTP codes and the rate-limit headers (names and numbers only). Token from env T, never printed."""
import json, os, sys, time, urllib.error, urllib.request

n = sys.argv[1] if len(sys.argv) > 1 else "2"
base = f"https://studio-novaai2026-coder-inference-server{'' if n == '1' else '-' + n}.api-inference.modelscope.net/gradio_api"
H = {"Authorization": "Bearer " + os.environ["T"], "content-type": "application/json"}

def hit():
    t0 = time.time()
    try:
        r = urllib.request.urlopen(urllib.request.Request(f"{base}/call/v2/status", b"{}", H), timeout=30)
        code, hd = r.status, dict(r.headers)
    except urllib.error.HTTPError as e:
        code, hd = e.code, dict(e.headers)
    except Exception as e:
        return type(e).__name__, {}, time.time() - t0
    return code, hd, time.time() - t0

def keep(hd):
    return {k: v for k, v in hd.items() if k.lower().startswith(("retry", "x-ratelimit", "ratelimit", "x-rate", "x-envoy", "x-request"))}

print("headers of one normal answer:", keep(hit()[1]))
for label, per, count in (("A: 4 requests/second, 24 requests", 0.25, 24), ("B: 1 request every 3 s, 30 requests", 3.0, 30), ("C: 1 request every 12 s, 10 requests", 12.0, 10)):
    codes = []; first429 = None
    for i in range(count):
        c, hd, dt = hit(); codes.append(c)
        if c == 429 and first429 is None: first429 = (i, keep(hd))
        time.sleep(per)
    print(f"{label}: {''.join('.' if c == 200 else ('X' if c == 429 else '?') for c in codes)}  ({codes.count(200)} ok, {codes.count(429)} refused, other {[c for c in codes if c not in (200, 429)][:3]})", flush=True)
    if first429: print("  first refusal at request", first429[0] + 1, "headers", first429[1], flush=True)
