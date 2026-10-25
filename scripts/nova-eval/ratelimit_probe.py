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

import threading

def burst(n_threads, studios):
    codes = []; lock = threading.Lock()
    def one(st):
        global base
        b = f"https://studio-novaai2026-coder-inference-server{'' if st == '1' else '-' + st}.api-inference.modelscope.net/gradio_api"
        t0 = time.time()
        try:
            r = urllib.request.urlopen(urllib.request.Request(f"{b}/call/v2/status", b"{}", H), timeout=60)
            c, hd = r.status, dict(r.headers)
        except urllib.error.HTTPError as e:
            c, hd = e.code, dict(e.headers)
        except Exception as e:
            c, hd = type(e).__name__, {}
        with lock: codes.append((c, round(time.time() - t0, 1), keep(hd) if c == 429 else None))
    ts = [threading.Thread(target=one, args=(studios[i % len(studios)],)) for i in range(n_threads)]
    for t in ts: t.start()
    for t in ts: t.join()
    return codes

print("single call:", keep(hit()[1]))
for label, n, studios in (("2 at once, one Studio", 2, [n]), ("4 at once, one Studio", 4, [n]), ("6 at once, one Studio", 6, [n]), ("10 at once, one Studio", 10, [n]), ("5 at once, five Studios (one each)", 5, ["1", "2", "3", "4", "5"]), ("10 at once, five Studios (two each)", 10, ["1", "2", "3", "4", "5"]), ("20 at once, five Studios", 20, ["1", "2", "3", "4", "5"])):
    res = burst(n, studios)
    ok = sum(1 for c, _, _ in res if c == 200); bad = [x for x in res if x[0] == 429]
    print(f"{label}: {ok} ok, {len(bad)} refused (429), other {[c for c, _, _ in res if c not in (200, 429)][:3]}, slowest {max(t for _, t, _ in res)} s", flush=True)
    if bad: print("   refusal headers:", bad[0][2], flush=True)
    time.sleep(20)
