"""Read-only inventory of the account's ModelScope Studios: runtime state, hardware, and the app's own status (whitelisted numbers only, never a token or a user text).

Run by .github/workflows/modelscope-inventory.yml with the repo secret. Prints one JSON line per Studio and a table. Tests: scripts/ops/test_studio_inventory.py."""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request

OWNER = "novaai2026"
MS = "https://www.modelscope.cn"
# name -> role (from the deploy workflows in this repo)
KNOWN = {
    "nova-inference-server": "Nova legacy: Qwen2.5-VL-7B GGUF + mmproj (deploy-modelscope-studio.yml)",
    "coder-inference-server": "Nova coder replica 1 (deploy-modelscope-coder.yml)",
    "coder-inference-server-2": "Nova coder replica 2",
    "coder-inference-server-3": "Nova coder replica 3",
    "coder-inference-server-4": "Nova coder replica 4",
    "coder-inference-server-5": "Nova coder replica 5 (+vision)",
    "nova-media-server": "Nova media: image SDXS, speech Piper, video AnimateDiff-Lightning (deploy-modelscope-media.yml)",
    "sham-v1-server": "Sham (old): chat + image/speech from its own tokens (sham-modelscope.yml)",
    "sham-v2-server": "Sham v2: transplanted text body + ready image/speech + own video (deploy-modelscope-sham-v2.yml)",
}
KEEP = ("phase", "detail", "error", "model", "model_repo", "ctx", "threads", "vision", "cpus", "queue", "uptime_s", "mem_total_gb", "mem_available_gb", "images", "speech",
        "videos", "last_s")


def pick(status: dict) -> dict:
    """Whitelisted, number/short-string facts only."""
    out = {k: status[k] for k in KEEP if k in status and isinstance(status[k], (int, float, bool, str)) and len(str(status[k])) <= 120}
    d = status.get("disk")
    if isinstance(d, dict):
        if "free_gb" in d:
            out["disk_gb"] = {k: d[k] for k in ("total_gb", "used_gb", "free_gb") if k in d}
        elif "free_bytes" in d:
            out["disk_gb"] = {"total_gb": round(d.get("total_bytes", 0) / 2 ** 30, 2), "used_gb": round(d.get("used_bytes", 0) / 2 ** 30, 2), "free_gb": round(d["free_bytes"] / 2 ** 30, 2)}
    ma = status.get("media_assets")
    if isinstance(ma, dict):
        out["media_assets_ready"] = bool(ma.get("ready"))
    v = status.get("video")
    if isinstance(v, dict):
        out["video"] = {k: v[k] for k in ("engine", "ready", "device") if k in v}
    return out


def runtime(detail: dict) -> dict:
    d = detail or {}
    rt = d.get("runtime") if isinstance(d.get("runtime"), dict) else {}
    res = d.get("resource") if isinstance(d.get("resource"), dict) else {}
    return {"state": rt.get("status") or d.get("status"), "visibility": d.get("visibility"), "hardware": d.get("hardware") or rt.get("hardware") or res.get("name")}


def _http(url, token, body=None, timeout=25):
    req = urllib.request.Request(url, data=body, headers={"Authorization": f"Bearer {token}", "content-type": "application/json"}, method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except Exception as e:  # noqa: BLE001
        return 0, type(e).__name__


def app_status(name: str, token: str) -> tuple[int, dict]:
    base = f"https://studio-{OWNER}-{name}.api-inference.modelscope.net"
    code, txt = _http(f"{base}/gradio_api/call/v2/status", token, b"{}")
    if code != 200:
        return code, {}
    try:
        ev = json.loads(txt).get("event_id", "")
    except ValueError:
        return code, {}
    time.sleep(2)
    code2, sse = _http(f"{base}/gradio_api/call/status/{ev}", token)
    for line in sse.splitlines():
        if line.startswith("data:"):
            try:
                v = json.loads(line[5:].strip())
                v = v[0] if isinstance(v, list) and v else v
                v = json.loads(v) if isinstance(v, str) else v
                return code2, v if isinstance(v, dict) else {}
            except ValueError:
                pass
    return code2, {}


def main() -> int:
    token = os.environ.get("MODELSCOPE_TOKEN", "")
    code, txt = _http(f"{MS}/openapi/v1/studios?owner={OWNER}&page_size=100", token)
    listed = []
    if code == 200:
        try:
            d = json.loads(txt).get("data") or {}
            items = d.get("studios") or d.get("items") or (d if isinstance(d, list) else [])
            listed = sorted({str(i.get("repo_name") or i.get("name") or "") for i in items if isinstance(i, dict)} - {""})
        except ValueError:
            pass
    print(f"studios listed by the API (http {code}): {listed}")
    names = list(KNOWN) + [n for n in listed if n not in KNOWN]
    for n in names:
        c, t = _http(f"{MS}/openapi/v1/studios/{OWNER}/{n}", token)
        try:
            det = (json.loads(t).get("data") or {}) if c == 200 else {}
        except ValueError:
            det = {}
        rt = runtime(det)
        ac, st = app_status(n, token) if c == 200 else (0, {})
        print(json.dumps({"name": n, "role": KNOWN.get(n, "UNKNOWN (not in this repo)"), "modelscope_http": c, "runtime": rt, "app_http": ac, "app": pick(st)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
