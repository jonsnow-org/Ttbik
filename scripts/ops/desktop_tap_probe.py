#!/usr/bin/env python3
"""Throwaway-session probe of the computer hub's desktop: start a phone-shaped desktop, tap the taskbar buttons and the desktop icons
the way the Mini App does (xdotool click at a point) and save a frame after each, so what a tap really does can be SEEN.
Needs MODELSCOPE_TOKEN; never prints it. Frames go to PROBE_FRAMES_DIR."""
from __future__ import annotations

import base64
import os
import sys
import time
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import modelscope_computer_smoke as m  # noqa: E402

API = "https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net"
W, H = 900, 1300
OUT = os.environ.get("PROBE_FRAMES_DIR", "probe-frames")


def call(token: str, session: str, **payload):
    return m.desktop_call(API, token, {**payload, "session": session}, timeout=60)


def save(token: str, session: str, name: str) -> None:
    f = call(token, session, action="frame", quality=60, scale=0.6)
    shot = f.get("screenshot_b64")
    if isinstance(shot, str) and shot:
        os.makedirs(OUT, exist_ok=True)
        with open(os.path.join(OUT, name + ".jpg"), "wb") as fh:
            fh.write(base64.b64decode(shot))
    print(name, "ok" if shot else "NO FRAME", f.get("width"), f.get("height"), flush=True)


def main() -> int:
    token = os.environ.get("MODELSCOPE_TOKEN", "")
    if not token:
        print("MODELSCOPE_TOKEN missing")
        return 2
    session = "probe:" + uuid.uuid4().hex[:8]
    s = call(token, session, action="start", width=W, height=H)
    print("start", s.get("phase"), s.get("error"), flush=True)
    for _ in range(60):
        st = call(token, session, action="status")
        if st.get("phase") == "running":
            break
        if st.get("phase") == "failed":
            print("failed", st.get("error"))
            return 1
        time.sleep(5)
    else:
        print("never running")
        return 1
    try:
        print("size", st.get("width"), st.get("height"), flush=True)
        time.sleep(3)
        save(token, session, "0-start")
        steps = [
            ("1-icon-browser-single", [("click", 60, 40)], 8),
            ("2-taskbar-terminal", [("click", 141, H - 22)], 4),
            ("3-taskbar-files", [("click", 220, H - 22)], 8),
        ]
        for name, clicks, wait in steps:
            for kind, x, y in clicks:
                r = call(token, session, action=kind, x=x, y=y)
                print(name, kind, x, y, "ok" if r.get("ok", True) else r.get("error"), flush=True)
                time.sleep(0.12)
            time.sleep(wait)
            save(token, session, name)
        # why a window did not appear: the launcher logs and what is running
        r = m.box_call(API, token, {"action": "run", "session": session, "timeout": 20, "command":
                       "for f in ~/.desktop/*.log; do echo \"== $f\"; tail -n 8 \"$f\"; done; echo == procs; ps -eo pid,args | grep -E 'pcmanfm|tint2|chrome --' | grep -v grep | cut -c1-150 | head -12"}, timeout=40)
        print("LOGS", str(r.get("output", ""))[:3000], flush=True)
    finally:
        call(token, session, action="stop")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
