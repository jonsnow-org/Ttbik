#!/usr/bin/env python3
"""Live proof that each model's OWN computer shows a working screen: for every target (Sham's own Studio, Sham Pro's own Studio, Nova's mini-app
computer hub) start that model's desktop in a dedicated verification session, open the browser on a page, save the picture the live view shows,
then stop the session. Each model is reached only through its own endpoint and its own session key; nothing is shared or redeployed.
Prints facts only; the token comes from the environment (T) and is never printed. Offline self-test: --selftest
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sham_embedded_env_probe import call  # noqa: E402

PAGE = os.environ.get("SHOT_URL", "https://example.com/")


def do(base: str, token: str, session: str, **args) -> dict:
    return call(base, token, "desktop_do", {"session": session, **args}, timeout=150)


def picture(reply: dict) -> bytes:
    raw = str(reply.get("screenshot_b64") or "")
    return base64.b64decode(raw) if raw else b""


def shoot(name: str, base: str, token: str, out: str, wait_s: int = 1500) -> bool:
    session = f"verify-shot:{name}"
    ok = False
    try:
        r = do(base, token, session, action="start", width=640, height=1000)
        print(f"{name}: start -> {json.dumps({k: v for k, v in r.items() if k != 'screenshot_b64'})[:240]}", flush=True)
        t0 = time.time()
        while r.get("phase") in ("installing", "stopped", "starting") and time.time() - t0 < wait_s:
            time.sleep(20)
            r = do(base, token, session, action="status")
            print(f"{name}: status -> {r.get('phase')} {r.get('install_note', '')}", flush=True)
            if r.get("phase") == "stopped" and time.time() - t0 > 60:
                r = do(base, token, session, action="start", width=640, height=1000)
        if r.get("phase") != "running":
            print(f"{name}: NOT RUNNING: {json.dumps(r)[:300]}")
            return False
        launched = do(base, token, session, action="launch", app="browser", url=PAGE)
        print(f"{name}: browser launch -> ok={launched.get('ok')} {str(launched.get('error') or '')[:160]}", flush=True)
        best = b""
        for _ in range(6):
            time.sleep(8)
            shot = do(base, token, session, action="move", x=8, y=8)
            pic = picture(shot) or picture(do(base, token, session, action="frame"))
            if len(pic) > len(best):
                best = pic
        state = do(base, token, session, action="state") if name.startswith("sham") else {}
        if best:
            path = os.path.join(out, f"{name}.jpg")
            with open(path, "wb") as f:
                f.write(best)
            print(f"{name}: saved {path} ({len(best)} bytes) windows={state.get('windows')}", flush=True)
        ok = len(best) > 5000
    except Exception as exc:  # noqa: BLE001
        print(f"{name}: failed {type(exc).__name__}: {str(exc)[:200]}")
    finally:
        try:
            do(base, token, session, action="stop")
        except Exception:  # noqa: BLE001
            pass
    print(f"{name}: {'PASS' if ok else 'FAIL'}")
    return ok


def main() -> int:
    token = os.environ.get("T", "")
    out = os.environ.get("SHOT_DIR", "computer-shots")
    os.makedirs(out, exist_ok=True)
    only = {x for x in os.environ.get("SHOT_ONLY", "").split(",") if x}
    targets = {
        "sham_v1": os.environ.get("SHAM_MODELSCOPE_URL", ""),
        "sham_v2": os.environ.get("SHAM_V2_URL", ""),
        "nova": os.environ.get("COMPUTER_STUDIO_URL", ""),
    }
    results = {n: shoot(n, b.split(",")[0].strip().rstrip("/"), token, out) for n, b in targets.items() if b and token and (not only or n in only)}
    print("RESULTS " + json.dumps(results))
    return 0 if results and all(results.values()) else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        assert picture({"screenshot_b64": base64.b64encode(b"x").decode()}) == b"x" and picture({}) == b""
        print("computer_live_shots self-test OK")
        raise SystemExit(0)
    raise SystemExit(main())
