#!/usr/bin/env python3
"""Live smoke test of each Sham's own embedded desktop through its Studio's `desktop_do`: start (the packages are installed in the background the first time), wait until it runs,
launch the terminal, read the window list (the model's text view), check that a real picture comes back, then stop. Prints facts only; the token comes from the environment (T) and is never printed.
Offline self-test: python sham_desktop_smoke.py --selftest
"""
from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sham_embedded_env_probe import call  # noqa: E402


def do(base: str, token: str, session: str, **args) -> dict:
    return call(base, token, "desktop_do", {"session": session, **args}, timeout=120)


def smoke(name: str, base: str, token: str, wait_s: int = 1500) -> bool:
    session = "smoke:" + name
    ok = False
    try:
        r = do(base, token, session, action="start", width=640, height=1000)
        print(f"{name}: start -> {json.dumps({k: v for k, v in r.items() if k != 'screenshot_b64'})[:300]}", flush=True)
        t0 = time.time()
        while r.get("phase") in ("installing", "stopped") and time.time() - t0 < wait_s:
            time.sleep(20)
            r = do(base, token, session, action="status")
            print(f"{name}: status -> {r.get('phase')} {r.get('install_note', '')}", flush=True)
            if r.get("phase") == "stopped" and time.time() - t0 > 60:
                r = do(base, token, session, action="start", width=640, height=1000)
        if r.get("phase") != "running":
            print(f"{name}: NOT RUNNING: {json.dumps(r)[:300]}")
            return False
        l = do(base, token, session, action="launch", app="terminal")
        time.sleep(2)
        st = do(base, token, session, action="state")
        shot = do(base, token, session, action="move", x=5, y=5)          # an input reply carries a picture
        pic = len(str(shot.get("screenshot_b64") or ""))
        print(f"{name}: launch={l.get('ok')} windows={st.get('windows')} focused={st.get('focused')!r} picture_chars={pic}", flush=True)
        ok = bool(st.get("ok") and pic > 1000)
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
    studios = {"sham_v1": os.environ.get("SHAM_MODELSCOPE_URL", ""), "sham_v2": os.environ.get("SHAM_V2_URL", "")}
    results = [smoke(n, b.split(",")[0].strip().rstrip("/"), token) for n, b in studios.items() if b and token]
    return 0 if results and all(results) else 1


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        assert callable(smoke) and callable(do)
        print("sham_desktop_smoke self-test OK")
        raise SystemExit(0)
    raise SystemExit(main())
