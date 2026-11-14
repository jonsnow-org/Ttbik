#!/usr/bin/env python3
"""Read-only probe: asks each Sham Studio (v1 and v2) what its container can do for an embedded graphical desktop (root, apt, Xvfb, xdotool, free memory, cores).

It calls the Studio's read-only `computer_view` with action=env. Nothing is changed. The token comes from the environment (T), never printed.
Offline self-test: python sham_embedded_env_probe.py --selftest
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
import urllib.parse
import urllib.request


def call(base: str, token: str, name: str, payload: dict, timeout: int = 60) -> dict:
    wire = "b64:" + base64.b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode("ascii")
    headers = {"Authorization": "Bearer " + token, "Content-Type": "application/json", "User-Agent": "Ttbik-Embedded-Env-Probe/1.0"}
    req = urllib.request.Request(f"{base}/gradio_api/call/{name}", data=json.dumps({"data": [wire]}).encode(), headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        event = json.loads(r.read().decode())["event_id"]
    url = f"{base}/gradio_api/call/{name}/{urllib.parse.quote(event, safe='')}"
    req = urllib.request.Request(url, headers={**headers, "Accept": "text/event-stream"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        for raw in r:
            line = raw.decode("utf-8", "replace").strip()
            if line.startswith("data:"):
                data = json.loads(line[5:].strip())
                return json.loads(data[0]) if isinstance(data, list) and data and isinstance(data[0], str) else {"raw": data}
    return {"ok": False, "error": "no data"}


def main() -> int:
    token = os.environ.get("T", "")
    studios = {"sham_v1": os.environ.get("SHAM_MODELSCOPE_URL", ""), "sham_v2": os.environ.get("SHAM_V2_URL", "")}
    code = 0
    for name, base in studios.items():
        base = base.split(",")[0].strip().rstrip("/")
        if not base or not token:
            print(f"{name}: skipped (no url or token)")
            continue
        try:
            t0 = time.time()
            reply = call(base, token, "computer_view", {"action": "env", "session": "probe"})
            print(f"{name}: {json.dumps(reply, ensure_ascii=False)} ({time.time() - t0:.1f}s)")
        except Exception as exc:  # noqa: BLE001
            print(f"{name}: failed {type(exc).__name__}: {str(exc)[:160]}")
            code = 1
    return code


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        assert callable(call)
        print("sham_embedded_env_probe self-test OK")
        raise SystemExit(0)
    raise SystemExit(main())
