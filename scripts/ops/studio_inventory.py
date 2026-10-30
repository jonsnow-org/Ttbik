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
    "nova-inference-server": "Nova legacy text/vision Studio",
    "coder-inference-server": "Nova coder replica 1",
    "coder-inference-server-2": "Nova coder replica 2",
    "coder-inference-server-3": "Nova coder replica 3",
    "coder-inference-server-4": "Nova coder replica 4",
    "coder-inference-server-5": "Nova coder replica 5 (+vision)",
    "nova-media-server": "Nova shared media: SDXS image + Piper Arabic speech + AnimateDiff video",
    "sham-v1-server": "Sham old: chat + own image/audio tokens",
    "sham-v2-server": "Sham v2 chat + packaged image/audio weights",
    "sham-v2-overflow-server": "Sham v2 text overflow replica",
    "sham-v2-video-server": "Sham v2 dedicated video generation",
    "sham-donor-qwen35-9b-test": "Qwen3.5-9B donor candidate",
    "sham-donor-gemma4-e4b-test": "Gemma 4 E4B donor candidate",
    "sham-donor-minicpmo45-test": "MiniCPM-o 4.5 donor candidate",
}
KEEP = (
    "phase", "detail", "error", "model", "model_repo", "app_revision", "ctx", "context_tokens",
    "threads", "vision", "audio", "speech", "tts", "cpus", "queue", "uptime_s",
    "mem_total_gb", "mem_available_gb", "images", "videos", "last_s",
)


def pick(status: dict) -> dict:
    """Whitelisted, number/short-string facts only."""
    out = {k: status[k] for k in KEEP if k in status and isinstance(status[k], (int, float, bool, str)) and len(str(status[k])) <= 120}
    d = status.get("disk")
    if isinstance(d, dict):
        if "free_gb" in d:
            out["disk_gb"] = {k: d[k] for k in ("total_gb", "used_gb", "free_gb") if k in d}
        elif "free_bytes" in d:
            out["disk_gb"] = {"total_gb": round(d.get("total_bytes", 0) / 2 ** 30, 2), "used_gb": round(d.get("used_bytes", 0) / 2 ** 30, 2), "free_gb": round(d["free_bytes"] / 2 ** 30, 2)}
    for key in ("media_capabilities", "model_native_outputs", "runtime_generation_capabilities"):
        value = status.get(key)
        if isinstance(value, dict):
            out[key] = {str(k): bool(v) for k, v in value.items() if isinstance(v, (bool, int))}
    resources = status.get("runtime_resources")
    if isinstance(resources, dict):
        resource_keys = ("MemTotal", "MemAvailable", "SwapTotal", "SwapFree", "process_VmRSS", "process_VmHWM", "process_Threads")
        out["runtime_resources"] = {
            key: str(resources[key])[:40]
            for key in resource_keys if key in resources and isinstance(resources[key], (str, int, float))
        }
    ma = status.get("media_assets")
    if isinstance(ma, dict):
        out["media_assets_ready"] = bool(ma.get("ready"))  # retained for existing dashboards/tests
        out["media_assets"] = {
            "ready": bool(ma.get("ready")),
            **({"image_bytes": int(ma["image_bytes"])} if isinstance(ma.get("image_bytes"), (int, float)) else {}),
            **({"audio_bytes": int(ma["audio_bytes"])} if isinstance(ma.get("audio_bytes"), (int, float)) else {}),
        }
    v = status.get("video")
    if isinstance(v, dict):
        out["video"] = {k: v[k] for k in ("engine", "ready", "device", "mode") if k in v and isinstance(v[k], (str, int, float, bool))}
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


def _decode_sse_status(sse: str) -> dict:
    for line in sse.splitlines():
        if not line.startswith("data:"):
            continue
        try:
            value = json.loads(line[5:].strip())
            if isinstance(value, list) and value:
                value = value[0]
            if isinstance(value, str):
                value = json.loads(value)
            if isinstance(value, dict):
                return value
        except (ValueError, TypeError):
            continue
    return {}


def _unwrap_direct_status(payload: dict) -> dict:
    value = payload.get("data", payload)
    if isinstance(value, list) and value:
        value = value[0]
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return {}
    return value if isinstance(value, dict) else {}


def app_status(name: str, token: str) -> tuple[int, dict]:
    """Try Gradio 6 queued v2, classic queued, then direct run; status probes are read-only."""
    base = f"https://studio-{OWNER}-{name}.api-inference.modelscope.net"
    last_code = 0
    for submit_path, body, mode in (
        ("/gradio_api/call/v2/status", b"{}", "queued"),
        ("/gradio_api/call/status", b"{}", "queued"),
        ("/gradio_api/run/status", b'{"data":[]}', "direct"),
    ):
        code, txt = _http(base + submit_path, token, body, timeout=30)
        last_code = code
        if code != 200:
            continue
        try:
            submitted = json.loads(txt)
        except ValueError:
            continue
        if mode == "direct":
            status = _unwrap_direct_status(submitted)
            if status:
                return code, status
            continue
        event_id = submitted.get("event_id", "") if isinstance(submitted, dict) else ""
        if not event_id:
            continue
        time.sleep(2)
        for poll_path in (f"/gradio_api/call/status/{event_id}", f"/gradio_api/call/v2/status/{event_id}"):
            poll_code, sse = _http(base + poll_path, token, timeout=30)
            last_code = poll_code
            status = _decode_sse_status(sse)
            if status:
                return poll_code, status
    return last_code, {}


def studio_list_url(page_number: int, page_size: int = 50, owner: str = OWNER) -> str:
    """ModelScope Studio listing uses page_number, status=all and max page_size 50."""
    return (
        f"{MS}/openapi/v1/studios?owner={owner}&status=all"
        f"&page_number={page_number}&page_size={page_size}"
    )


def extract_studio_page(root: dict) -> tuple[list, int | None, list[str]]:
    """Accept the official bare response and older wrapped variants without dumping private metadata."""
    containers = [root]
    for key in ("data", "Data", "result", "Result"):
        if isinstance(root.get(key), dict):
            containers.append(root[key])
    for container in containers:
        items = next((container.get(key) for key in ("studios", "items", "list") if isinstance(container.get(key), list)), None)
        if items is not None:
            total = container.get("total_count") or container.get("total") or container.get("count")
            try:
                total = int(total) if total is not None else None
            except (ValueError, TypeError):
                total = None
            return items, total, list(container.keys())
    return [], None, list(root.keys())


def _hardware_summary(token: str, studio: str | None = None) -> tuple[int, list[dict]]:
    url = f"{MS}/openapi/v1/studios/hardware?sdk_type=gradio"
    if studio:
        url += "&studio=" + studio
    code, raw = _http(url, token)
    if code != 200:
        return code, []
    try:
        root = json.loads(raw)
        data = root.get("data") or root.get("Data") or root
        items = data if isinstance(data, list) else (
            data.get("hardware") or data.get("items") or data.get("list") or []
        )
        safe = []
        for item in items:
            if not isinstance(item, dict):
                continue
            safe.append({
                key: item[key] for key in ("name", "resource_type", "cpu", "memory", "gpu", "description")
                if key in item and isinstance(item[key], (str, int, float, bool))
            })
        return code, safe
    except (ValueError, TypeError, AttributeError):
        return code, []


def main() -> int:
    token = os.environ.get("MODELSCOPE_TOKEN", "")
    listed_set = set()
    code = 0
    total_count = None
    used_owner = None
    page_size = 50
    # First use the special 'me' owner accepted by the account CLI, then try the canonical username.
    for owner_filter in ("me", OWNER):
        probe_code, probe_text = _http(studio_list_url(1, page_size, owner_filter), token)
        if code == 0:
            code = probe_code
        if probe_code != 200:
            continue
        try:
            probe = json.loads(probe_text)
            probe_items, probe_total, probe_keys = extract_studio_page(probe)
            if probe_items or (probe_total is not None and probe_total > 0):
                used_owner = owner_filter
                total_count = probe_total
                listed_set.update({
                    str(item.get("repo_id") or item.get("id") or item.get("repo_name") or item.get("name") or item.get("repo") or "").strip()
                    .split("/")[-1]
                    for item in probe_items if isinstance(item, dict)
                } - {""})
                break
            # If the response carries an API error or a different schema, expose only safe shape metadata.
            print(f"studio-list probe owner={owner_filter}: keys={probe_keys}; count={len(probe_items)}; total={probe_total}")
        except (ValueError, TypeError, AttributeError):
            continue

    if used_owner:
        for page in range(2, 61):
            page_code, txt = _http(studio_list_url(page, page_size, used_owner), token)
            if page_code != 200:
                break
            try:
                root = json.loads(txt)
                items, page_total, _keys = extract_studio_page(root)
                if total_count is None:
                    total_count = page_total
                page_names = {
                    str(item.get("repo_id") or item.get("id") or item.get("repo_name") or item.get("name") or item.get("repo") or "").strip()
                    .split("/")[-1]
                    for item in items if isinstance(item, dict)
                } - {""}
                new_names = page_names - listed_set
                listed_set.update(new_names)
                if not items or not new_names or (total_count and len(listed_set) >= total_count) or len(items) < page_size:
                    break
            except (ValueError, TypeError, AttributeError):
                break

    listed = sorted(listed_set)
    print(f"studios listed by the API (http {code}; owner={used_owner}; total={total_count}): {listed}")
    hw_code, hardware = _hardware_summary(token)
    print(json.dumps({"hardware_catalog_http": hw_code, "hardware_options": hardware}, ensure_ascii=False))
    scoped_code, scoped_hardware = _hardware_summary(token, f"{OWNER}/nova-media-server")
    print(json.dumps({"studio_hardware_check": "nova-media-server", "http": scoped_code, "options": scoped_hardware}, ensure_ascii=False))
    names = sorted(set(KNOWN) | set(listed))
    for n in names:
        c, t = _http(f"{MS}/openapi/v1/studios/{OWNER}/{n}", token)
        try:
            det = (json.loads(t).get("data") or {}) if c == 200 else {}
        except ValueError:
            det = {}
        rt = runtime(det)
        runtime_state = str(rt.get("state") or "").lower()
        # Sleeping / stopped Studio apps cannot answer Gradio calls; avoid spending 3×30s on dead endpoints.
        ac, st = app_status(n, token) if c == 200 and runtime_state in ("running", "ready") else (0, {})
        print(json.dumps({"name": n, "role": KNOWN.get(n, "UNKNOWN (not in this repo)"), "modelscope_http": c, "runtime": rt, "app_http": ac, "app": pick(st)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
