"""Live smoke tests for the Sham v2 ModelScope Studio.

Sham v2 has exactly one generator, its OWN token generator (owner 2026-11-11: no donor weights, no outside model anywhere). Each medium is requested from it and run through the same
content gate the Studio applies (not black / constant / noise, not silent, not a frozen video). A medium that fails the gate FAILS the run: that is the honest state of the generator,
not something to hide. SMOKE_KINDS (default image,audio,video) narrows what is tested.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
from urllib.error import URLError
from urllib.request import Request, urlopen

BASE = (os.environ.get("SHAM_V2_URL") or "https://studio-novaai2026-sham-v2-server.api-inference.modelscope.net").rstrip("/")
TOKEN = (os.environ.get("MODELSCOPE_TOKEN") or "").strip()

# the same content gate the Studio applies (ai-system/colab/sham_small/media_quality.py): a size check alone passes a black 512x512 PNG
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "colab", "sham_small"))
from media_quality import MediaQualityError, check_image, check_mp4, check_wav  # noqa: E402


def assert_content(kind: str, raw: bytes) -> dict:
    """Raise RuntimeError unless the bytes are real media: not black / constant / noise, not silent, not an empty or frozen video."""
    try:
        return {"image": check_image, "audio": check_wav, "video": check_mp4}[kind](raw)
    except MediaQualityError as exc:
        raise RuntimeError(f"{kind}: content check failed ({exc.reason}: {exc.detail})") from exc


def request_json(url: str, method: str = "GET", payload: dict | None = None, timeout: int = 60):
    headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
    data = json.dumps(payload or {}).encode() if payload is not None else None
    req = Request(url, data=data, headers=headers, method=method)
    with urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def unwrap(body):
    for line in body.splitlines():
        if not line.startswith("data:"):
            continue
        try:
            data = json.loads(line[5:].strip())
            value = data[0] if isinstance(data, list) and data else data
            if isinstance(value, str):
                try:
                    return json.loads(value)
                except json.JSONDecodeError:
                    return value
            return value
        except json.JSONDecodeError:
            continue
    return None


def call(api: str, payload: dict, timeout: int = 300):
    sub = request_json(f"{BASE}/gradio_api/call/v2/{api}", "POST", payload, timeout=40)
    event = sub.get("event_id")
    if not event:
        raise RuntimeError(f"{api}: Studio returned no event_id: {str(sub)[:200]}")
    deadline = time.monotonic() + timeout
    last_error = ""
    # Gradio returns a long-lived SSE stream. Read complete lines as they arrive;
    # res.read() waits for EOF and can time out while the model is still streaming.
    while time.monotonic() < deadline:
        req = Request(f"{BASE}/gradio_api/call/{api}/{event}", headers={"Authorization": f"Bearer {TOKEN}"})
        try:
            with urlopen(req, timeout=min(45, max(5, int(deadline - time.monotonic())))) as res:
                while time.monotonic() < deadline:
                    line = res.readline()
                    if not line:
                        break
                    value = unwrap(line.decode("utf-8", errors="replace"))
                    if value is not None:
                        return value
        except (TimeoutError, URLError, OSError) as exc:
            last_error = f"{type(exc).__name__}: {str(exc)[:100]}"
        time.sleep(1)
    raise TimeoutError(f"{api}: timed out after {timeout}s; last stream error: {last_error}")


def media(kind: str, backend: str = "internal"):
    label = {
        "internal": "شام الداخلي (الأساسي)",
    }[backend]
    value = call("generate_media_from_panel", {
        "kind": kind,
        "prompt": "a small red apple on a clean white table, natural light",
        "backend_label": label,
        "scenes_json": json.dumps([
            "Wide shot: a small red apple on a white table",
            "Close-up: natural light across the apple",
            "Side view: the apple on the table",
        ]),
        "narration": "تفاحة حمراء صغيرة على طاولة بيضاء.",
    }, timeout=360)
    if not isinstance(value, dict):
        raise RuntimeError(f"{backend}/{kind}: response is not a JSON object: {str(value)[:200]}")
    if value.get("type") == "error" or not value.get("b64"):
        raise RuntimeError(f"{backend}/{kind}: {value.get('text') or value.get('type') or 'no media bytes'}")
    raw = base64.b64decode(value["b64"], validate=False)
    if len(raw) < 128:
        raise RuntimeError(f"{backend}/{kind}: media payload suspiciously small ({len(raw)} bytes)")
    expected = {"image": "image", "audio": "audio", "video": "video"}[kind]
    if value.get("type") != expected:
        raise RuntimeError(f"{backend}/{kind}: expected type {expected}, got {value.get('type')}")
    out_dir = os.environ.get("SMOKE_OUT", "").strip()
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
        with open(os.path.join(out_dir, f"sham_v2_{kind}.{ {'image': 'png', 'audio': 'wav', 'video': 'mp4'}[kind] }"), "wb") as fh:
            fh.write(raw)
    stats = assert_content(kind, raw)
    print(f"PASS {backend}/{kind}: {len(raw)} bytes; mime={value.get('mime', 'unspecified')}; content={stats}")
    return raw


def main() -> int:
    if not TOKEN:
        print("FAIL: MODELSCOPE_TOKEN missing")
        return 2
    print(f"Studio: {BASE}")
    last: dict = {}
    deadline = time.time() + 300
    while time.time() < deadline:
        try:
            last = call("status", {}, timeout=30)
            if isinstance(last, str):
                last = json.loads(last)
            if isinstance(last, dict) and last.get("phase") == "ready":
                break
        except Exception as exc:
            print(f"Waiting for status: {type(exc).__name__}: {str(exc)[:120]}")
        time.sleep(10)
    if not isinstance(last, dict) or last.get("phase") != "ready":
        print("FAIL: Sham v2 text model is not ready:", json.dumps(last, ensure_ascii=False)[:1000])
        return 1
    print("PASS status: the Studio is ready")
    only = [k for k in os.environ.get("SMOKE_KINDS", "image,audio,video").split(",") if k.strip() in ("image", "audio", "video")]
    failed = []
    for kind in only:
        started = time.time()
        try:
            media(kind, "internal")
        except Exception as exc:   # one medium failing never hides the others
            failed.append(kind)
            print(f"FAIL internal/{kind}: {type(exc).__name__}: {str(exc)[:240]}")
        print(f"   ({kind} took {time.time() - started:.0f}s)")
    if failed:
        print("FAIL: Sham v2's own generator did not produce usable " + ", ".join(failed))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
