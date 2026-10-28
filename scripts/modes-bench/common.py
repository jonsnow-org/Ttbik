"""Shared Gradio-call helper for the modes benchmark (reads MODELSCOPE_TOKEN from the environment; never prints it)."""
import json, os, time, urllib.request, urllib.error

TOKEN = os.environ.get("T", "")
HDR = {"Authorization": "Bearer " + TOKEN, "content-type": "application/json"}


def op(req, t=120):
    for k in range(6):
        try:
            return urllib.request.urlopen(req, timeout=t).read().decode()
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(5 * (k + 1))
    raise SystemExit("still 429")


def call(base, name, data, t=120):
    req = urllib.request.Request(f"{base}/gradio_api/call/v2/{name}", json.dumps(data).encode(), HDR)
    ev = json.loads(op(req, 60))["event_id"]
    raw = op(urllib.request.Request(f"{base}/gradio_api/call/{name}/{ev}", headers=HDR), t)
    lines = [l for l in raw.splitlines() if l.startswith("data:")]
    if not lines:
        return {"type": "error", "text": raw[:200]}
    v = json.loads(lines[-1][5:])[0]
    try:
        return json.loads(v)
    except Exception:
        return v


def nova_base(n):
    return f"https://studio-novaai2026-coder-inference-server{'' if str(n) == '1' else '-' + str(n)}.api-inference.modelscope.net"


SHAM_V2 = "https://studio-novaai2026-sham-v2-server.api-inference.modelscope.net"
SHAM_V2_OVERFLOW = "https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net"
