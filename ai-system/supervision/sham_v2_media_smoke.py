"""Live smoke tests for the Sham v2 ModelScope Studio.

Required local-ready tests fail the workflow. Internal token-decoder and HF external
routes are diagnostic: failures are printed explicitly because the former is
known to be untrained and the latter may be blocked by ZeroGPU quota/licensing.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import time
from urllib.request import Request, urlopen

BASE = (os.environ.get("SHAM_V2_URL") or "https://studio-novaai2026-sham-v2-server.api-inference.modelscope.net").rstrip("/")
TOKEN = (os.environ.get("MODELSCOPE_TOKEN") or "").strip()
HF_TOKEN = (os.environ.get("HF_TOKEN1") or "").strip()


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
    deadline = time.time() + timeout
    while time.time() < deadline:
        req = Request(f"{BASE}/gradio_api/call/{api}/{event}", headers={"Authorization": f"Bearer {TOKEN}"})
        with urlopen(req, timeout=min(45, max(5, int(deadline-time.time())))) as res:
            body = res.read().decode("utf-8", errors="replace")
        value = unwrap(body)
        if value is not None:
            return value
        time.sleep(2)
    raise TimeoutError(f"{api}: timed out after {timeout}s")


def media(kind: str, backend: str):
    label = {
        "ready": "المسار البديل (أوزان محلية جاهزة)",
        "hf": "المسار الخارجي (Hugging Face)",
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
    print(f"PASS {backend}/{kind}: {len(raw)} bytes; mime={value.get('mime', 'unspecified')}")
    return raw


def main() -> int:
    if not TOKEN:
        print("FAIL: MODELSCOPE_TOKEN missing")
        return 2
    print(f"Studio: {BASE}")
    last = {}
    deadline = time.time() + 300
    while time.time() < deadline:
        try:
            last = call("status", {}, timeout=30)
            if isinstance(last, str):
                last = json.loads(last)
            if isinstance(last, dict) and last.get("phase") == "ready" and last.get("media_assets", {}).get("ready"):
                break
        except Exception as exc:
            print(f"Waiting for status: {type(exc).__name__}: {str(exc)[:120]}")
        time.sleep(10)
    if not isinstance(last, dict) or last.get("phase") != "ready":
        print("FAIL: Sham v2 text model is not ready:", json.dumps(last, ensure_ascii=False)[:1000])
        return 1
    assets = last.get("media_assets", {})
    if not assets.get("ready"):
        print("FAIL: ready local media weights are not available:", json.dumps(assets, ensure_ascii=False)[:800])
        return 1
    print("PASS status: text model ready and media_assets.ready=true")

    text_answer = call("generate_text", {"prompt": "أجب بكلمة واحدة: مرحباً", "max_new_tokens": 24}, timeout=180)
    if not isinstance(text_answer, str) or not text_answer.strip():
        print("FAIL text generation: empty response")
        return 1
    print(f"PASS text generation: {text_answer.strip()[:160]}")

    for kind in ("image", "audio", "video"):
        media(kind, "ready")

    # Diagnostic only: the legacy token decoder is still under training and must not
    # block ready-weight service from working.
    try:
        internal = call("generate_media", {"kind": "image", "prompt": "a red apple on a white table"}, timeout=180)
        if isinstance(internal, dict) and internal.get("type") == "image" and internal.get("b64"):
            print(f"DIAGNOSTIC internal/image: returned {len(base64.b64decode(internal['b64']))} bytes; visual quality still requires review")
        else:
            print(f"DIAGNOSTIC internal/image: not usable: {str(internal)[:250]}")
    except Exception as exc:
        print(f"DIAGNOSTIC internal/image failed: {type(exc).__name__}: {str(exc)[:180]}")

    # External HF is tested against the real Space, but an exhausted free ZeroGPU
    # allowance or a gated model must not invalidate the independent local route.
    if HF_TOKEN:
        for kind in ("image", "video"):
            try:
                media(kind, "hf")
            except Exception as exc:
                print(f"WARNING hf/{kind}: {type(exc).__name__}: {str(exc)[:220]}")
    else:
        print("WARNING hf route: HF_TOKEN1 missing from Studio; external route intentionally unavailable.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
