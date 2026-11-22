#!/usr/bin/env python3
"""Read-only: asks each Sham trainer Studio for its `status` (phase, last cycle, error) so a trainer that never publishes can be diagnosed from facts.

Token from the environment (T, never printed). SITE=cn (default, account novaai2026, modelscope.net) or SITE=ai (account Jonjithup, modelscope.ai).
Repos from SHAM_TRAINER_REPOS (comma list; default depends on the site). Offline self-test: python sham_trainer_status.py --selftest
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request


def site() -> str:
    s = (os.environ.get("SITE") or "").strip().lower()
    if s not in ("cn", "ai"):
        raise SystemExit("SITE must be set to cn or ai (no default: cn would hit the wrong account for the international trainers)")
    return s


def owner() -> str:
    if os.environ.get("OWNER"):
        return os.environ["OWNER"].strip()
    return "Jonjithup" if site() == "ai" else "novaai2026"


def default_repos() -> str:
    return "sham-trainer-1" if site() == "ai" else "sham-trainer-1,sham-donor-qwen35-9b-test,sham-donor-gemma4-e4b-media"


def api(repo: str) -> str:
    host = "api-inference.modelscope.ai" if site() == "ai" else "api-inference.modelscope.net"
    return f"https://studio-{owner().lower()}-{repo}.{host}"


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
    for repo in [r.strip() for r in (os.environ.get("SHAM_TRAINER_REPOS") or default_repos()).split(",") if r.strip()]:
        try:
            st = call(repo, token)
            keep = {k: st.get(k) for k in ("phase", "job", "name", "error", "last", "cycle", "started", "minutes_since_last_line", "device", "leftover", "start") if k in st}
            noise = ("MB/s", "it/s", "Downloading [", "Processing ", "%|", "\x1b[A")                 # download progress bars filled the window and hid everything else (2026-11-14)
            lines = [l for l in (st.get("tail") or []) if "🧠" not in l and "🧵" not in l and not any(w in l for w in noise)]
            mem = [l for l in (st.get("tail") or []) if "🧠" in l][-1:]
            for line in lines[-20:] + mem:
                print(f"{repo} | {line}")
            print(f"{repo}: {json.dumps(keep or st, ensure_ascii=False)[:3500]}")                # the summary LAST: a short log tail always contains it
        except Exception as exc:  # noqa: BLE001
            print(f"{repo}: unreachable {type(exc).__name__}: {str(exc)[:120]}")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        os.environ.pop("OWNER", None)
        os.environ["SITE"] = "cn"
        assert api("x") == "https://studio-novaai2026-x.api-inference.modelscope.net"
        assert default_repos().startswith("sham-trainer-1")
        os.environ["SITE"] = "ai"
        assert api("sham-trainer-1") == "https://studio-jonjithup-sham-trainer-1.api-inference.modelscope.ai"
        assert default_repos() == "sham-trainer-1"
        os.environ["OWNER"] = "Jonjithup"
        assert api("sham-trainer-1") == "https://studio-jonjithup-sham-trainer-1.api-inference.modelscope.ai"
        os.environ.pop("SITE", None)
        os.environ.pop("OWNER", None)
        try:
            site()
            raise SystemExit("site() must require SITE")
        except SystemExit as exc:
            if "SITE must be set" not in str(exc):
                raise
        print("sham_trainer_status self-test OK")
        raise SystemExit(0)
    raise SystemExit(main())
