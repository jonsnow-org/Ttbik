#!/usr/bin/env python3
"""Read-only latency probe of the computer hub (owner 2026-11-14: "the computer is all errors").

The live workflow check showed trivial calls taking 7-26 s and some ending with an empty (null) result at ~25 s, while the same hub answers `status`
in ~2 s from a plain request. This probe separates the causes by timing each step on its own: the HTTP round trip of `status`, a no-op command, file
operations inside the session folder (persistent ossfs mount) against /tmp (local disk), a trivial python run, and a git clone. Throw-away session,
publishes nothing, never prints the token.  Usage: MODELSCOPE_TOKEN=... python computer_latency_probe.py --api https://studio-...modelscope.net
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modelscope_computer_smoke as smoke  # noqa: E402

FS_TEST = (
    "python3 - <<'PY'\n"
    "import os, time, tempfile\n"
    "def bench(root):\n"
    "    d = os.path.join(root, 'lat_probe'); os.makedirs(d, exist_ok=True)\n"
    "    t = time.perf_counter()\n"
    "    for i in range(40):\n"
    "        with open(os.path.join(d, f'f{i}.txt'), 'w') as f: f.write('x' * 512)\n"
    "    w = time.perf_counter() - t\n"
    "    t = time.perf_counter()\n"
    "    for i in range(40):\n"
    "        open(os.path.join(d, f'f{i}.txt')).read()\n"
    "    r = time.perf_counter() - t\n"
    "    t = time.perf_counter(); os.listdir(d); l = time.perf_counter() - t\n"
    "    for i in range(40): os.remove(os.path.join(d, f'f{i}.txt'))\n"
    "    return f'write40={w*1000:.0f}ms read40={r*1000:.0f}ms list={l*1000:.0f}ms'\n"
    "print('cwd   ', os.getcwd(), bench(os.getcwd()))\n"
    "print('tmp   ', bench('/tmp'))\n"
    "PY"
)


def timed(label: str, api: str, token: str, payload: dict, timeout: int = 120, name: str = "box_do") -> dict:
    t = time.time()
    try:
        r = smoke.gradio_call(api, name, payload, token, timeout)
        state = "ok" if r.get("ok", True) else "refused"
    except SystemExit as exc:          # smoke.fail() exits: an empty/null result lands here
        r, state = {}, f"FAIL({exc})"
    except Exception as exc:  # noqa: BLE001
        r, state = {}, f"FAIL({type(exc).__name__}: {str(exc)[:120]})"
    print(f"{time.time() - t:6.1f}s  {state:8s} {label}", flush=True)
    out = str(r.get("output", "")).strip()
    if out:
        print("          | " + out[:400].replace("\n", "\n          | "), flush=True)
    return r


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", required=True)
    ap.add_argument("--repo", default="https://github.com/jonsnow-org/Ttbik")
    args = ap.parse_args()
    token = (os.environ.get("MODELSCOPE_TOKEN") or "").strip()
    s = "latprobe:one"
    print("== one call at a time, same session (first call pays the session setup) ==")
    for i in range(3):
        timed(f"box_status #{i + 1}", args.api, token, {"session": s}, name="box_status", timeout=60)
    timed("box: run 'true' (first in session)", args.api, token, {"session": s, "action": "run", "command": "true"})
    for i in range(3):
        timed(f"box: run 'true' #{i + 2}", args.api, token, {"session": s, "action": "run", "command": "true"})
    timed("box: run python3 -c print", args.api, token, {"session": s, "action": "run", "command": "python3 -c \"print(sum(range(10)))\""})
    print("== file speed inside the session folder vs local /tmp ==")
    timed("fs benchmark", args.api, token, {"session": s, "action": "run", "command": FS_TEST})
    print("== sleep ladder (is there a wall-clock limit on one call?) ==")
    for n in (5, 15, 22, 28, 40):
        timed(f"box: run 'sleep {n}'", args.api, token, {"session": s, "action": "run", "command": f"sleep {n}; echo slept{n}"}, timeout=150)
    print("== file actions ==")
    timed("write", args.api, token, {"session": s, "action": "write", "path": "lat/a.txt", "content": "hello"})
    timed("read", args.api, token, {"session": s, "action": "read", "path": "lat/a.txt"})
    print("== repo clone ==")
    timed("repo", args.api, token, {"session": s, "action": "repo", "url": args.repo}, timeout=170)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
