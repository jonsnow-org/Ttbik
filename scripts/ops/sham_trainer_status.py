#!/usr/bin/env python3
"""Read-only: asks each Sham trainer Studio on the cn ModelScope account for its `status` (phase, last cycle, error) so a trainer that never publishes can be diagnosed from facts.

Token from the environment (T, never printed). Repos from SHAM_TRAINER_REPOS (comma list; default: the three cn trainers). Offline self-test: python sham_trainer_status.py --selftest
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request

OWNER = "novaai2026"
DEFAULT = "sham-trainer-1,sham-donor-qwen35-9b-test,sham-donor-gemma4-e4b-media"


def api(repo: str) -> str:
    return f"https://studio-{OWNER}-{repo}.api-inference.modelscope.net"


def call(repo: str, token: str, timeout: int = 40) -> dict:
    h = {"Authorization": "Bearer " + token, "Content-Type": "application/json"}
    req = urllib.request.Request(api(repo) + "/gradio_api/call/status", data=b'{"data": []}', headers=h, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        event = json.loads(r.read().decode())["event_id"]
    req = urllib.request.Request(api(repo) + "/gradio_api/call/status/" + event, headers={**h, "Accept": "text/event-stream"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        for raw in r:
            line = raw.decode("utf-8", "replace").strip()
            if line.startswith("data:"):
                data = json.loads(line[5:].strip())
                return json.loads(data[0]) if isinstance(data, list) and data and isinstance(data[0], str) else {"raw": data}
    return {"error": "no data"}


def main() -> int:
    token = os.environ.get("T", "")
    for repo in [r.strip() for r in (os.environ.get("SHAM_TRAINER_REPOS") or DEFAULT).split(",") if r.strip()]:
        try:
            st = call(repo, token)
            keep = {k: st.get(k) for k in ("phase", "job", "name", "error", "last", "cycle", "started", "minutes_since_last_line", "device") if k in st}
            print(f"{repo}: {json.dumps(keep or st, ensure_ascii=False)[:900]}")
            tail = [l for l in (st.get("tail") or []) if "🧠" not in l and "🧵" not in l]      # the memory watch prints every minute and would push the training lines out of the window
            mem = [l for l in (st.get("tail") or []) if "🧠" in l][-1:]
            for line in tail[-30:] + mem:
                print(f"{repo} | {line}")
        except Exception as exc:  # noqa: BLE001
            print(f"{repo}: unreachable {type(exc).__name__}: {str(exc)[:120]}")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        assert api("x") == "https://studio-novaai2026-x.api-inference.modelscope.net"
        print("sham_trainer_status self-test OK")
        raise SystemExit(0)
    raise SystemExit(main())
