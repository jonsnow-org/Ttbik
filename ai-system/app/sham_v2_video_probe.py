"""Live probe of Sham v2's own video Studio (ai-system/modelscope-sham-video/app.py): waits for ready, then asks for a real clip and checks it (frames > 1, motion).

Reuses the Studio client and content checks of nova_media_probe (same protocol, no shared Studio). Env: SHAM_V2_VIDEO_URL, MODELSCOPE_TOKEN, PROBE_PROMPT, PROBE_OUT, READY_TIMEOUT.
"""
from __future__ import annotations

import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nova_media_probe import ProbeError, Studio, _bytes, verify_video  # noqa: E402

DEFAULT_URL = "https://studio-novaai2026-sham-v2-video-server.api-inference.modelscope.net"


def main() -> int:
    base = os.environ.get("SHAM_V2_VIDEO_URL") or DEFAULT_URL
    token = (os.environ.get("MODELSCOPE_TOKEN") or "").strip()
    if not token:
        print("MODELSCOPE_TOKEN is not set")
        return 2
    st = Studio(base, token)
    try:
        s = st.wait_ready(float(os.environ.get("READY_TIMEOUT", "1800")))
        print(f"READY phase={s.get('phase')} engine={(s.get('video') or {}).get('engine')} cpus={s.get('cpus')} ram={s.get('ram')} disk={s.get('disk')}")
    except ProbeError as exc:
        print(f"FAIL ready: {exc}")
        return 1
    prompt = os.environ.get("PROBE_PROMPT", "").strip() or "a red apple slowly rotating on a white table, camera slowly orbiting"
    t0 = time.time()
    try:
        raw = _bytes(st.call("generate_video", {"prompt": prompt, "seconds": 2, "seed": 17}, timeout=900), "video", "video")
        with open(os.path.join(os.environ.get("PROBE_OUT", "."), "sham_v2_video.mp4"), "wb") as fh:
            fh.write(raw)
        print(f"PASS video: {len(raw)} bytes in {time.time() - t0:.0f}s {json.dumps(verify_video(raw))}")
        print("status after:", json.dumps(st.status())[:400])
        return 0
    except ProbeError as exc:
        print(f"FAIL video: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
