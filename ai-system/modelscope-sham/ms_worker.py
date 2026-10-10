"""
The Studio's worker process, started by app.py from SIGNED code that the GitHub bridge put in the model repo (studio_code/): a new version of
this file reaches the Studio by itself, no Redeploy click. app.py runs it only if the code's signature verifies (codesign.py) and restarts it when
the code changes. It runs WITHOUT the account token in its environment.

v1 (this file): find out what the Studio's network can actually reach, so the first real job is chosen on evidence, not on a guess.
It writes worker_status.json next to itself; app.py shows it in the `status` tab. Later versions add jobs (training on data the Studio can read,
publishing the result for a GitHub job to carry to Kaggle and the merge gate).
"""
from __future__ import annotations

import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
STATUS = HERE / "worker_status.json"
TARGETS = {
    "huggingface.co": "https://huggingface.co/api/models?limit=1",
    "hf-mirror.com": "https://hf-mirror.com/api/models?limit=1",
    "kaggle.com": "https://www.kaggle.com",
    "github.com": "https://github.com",
    "pypi.org": "https://pypi.org/simple/",
    "modelscope.cn": "https://www.modelscope.cn",
    "telegram.org": "https://api.telegram.org",
    "wikipedia.org": "https://ar.wikipedia.org/w/api.php?action=query&meta=siteinfo&format=json",
}


def reach(url: str, timeout: float = 12.0) -> str:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "sham-worker-probe"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return f"ok {r.status}"
    except urllib.error.HTTPError as e:
        return f"reachable (http {e.code})"          # the server answered: the network path exists
    except (socket.timeout, TimeoutError):
        return "timeout"
    except Exception as exc:
        return f"blocked ({type(exc).__name__})"


def probe() -> dict:
    return {host: reach(url) for host, url in TARGETS.items()}


def write_status(data: dict, path: Path = STATUS) -> None:
    path.write_text(json.dumps({**data, "updated": time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())}, ensure_ascii=False), encoding="utf-8")


def main() -> None:
    while True:
        try:
            write_status({"version": 1, "cpus": os.cpu_count(), "network": probe()})
        except Exception as exc:
            write_status({"version": 1, "error": f"{type(exc).__name__}: {str(exc)[:160]}"})
        time.sleep(3600)


if __name__ == "__main__":
    if "--once" in sys.argv:
        write_status({"version": 1, "cpus": os.cpu_count(), "network": probe()})
    else:
        main()
