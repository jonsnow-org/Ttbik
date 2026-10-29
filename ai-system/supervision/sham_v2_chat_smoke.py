#!/usr/bin/env python3
"""Live smoke test for Sham v2's native-role Qwen3 chat API."""
from __future__ import annotations

import json
import os
import time
from urllib.error import URLError
from urllib.request import Request, urlopen

BASE = (os.environ.get("SHAM_V2_URL") or "https://studio-novaai2026-sham-v2-server.api-inference.modelscope.net").strip().rstrip("/")
TOKEN = (os.environ.get("MODELSCOPE_TOKEN") or os.environ.get("MODELSCOPE_API_TOKEN") or "").strip()
EXPECTED_MODEL = "novaai2026/sham-v2"


def request_json(url: str, method: str = "GET", payload: dict | None = None, timeout: int = 45):
    headers = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
    data = json.dumps(payload or {}, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = Request(url, data=data, headers=headers, method=method)
    with urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def unwrap_line(line: str):
    if not line.startswith("data:"):
        return None
    try:
        values = json.loads(line[5:].strip())
    except json.JSONDecodeError:
        return None
    value = values[0] if isinstance(values, list) and values else values
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def call(api: str, payload: dict, timeout: int = 180):
    submitted = request_json(f"{BASE}/gradio_api/call/v2/{api}", "POST", payload, timeout=40)
    event_id = submitted.get("event_id")
    if not event_id:
        raise RuntimeError(f"{api}: no event_id returned")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        req = Request(f"{BASE}/gradio_api/call/{api}/{event_id}", headers={"Authorization": f"Bearer {TOKEN}"})
        try:
            with urlopen(req, timeout=min(30, max(5, int(deadline - time.monotonic())))) as res:
                while time.monotonic() < deadline:
                    line = res.readline()
                    if not line:
                        break
                    value = unwrap_line(line.decode("utf-8", errors="replace"))
                    if value is not None:
                        return value
        except (TimeoutError, URLError, OSError):
            pass
        time.sleep(1)
    raise TimeoutError(f"{api}: timed out after {timeout}s")


def chat(messages: list[dict], max_new_tokens: int = 256) -> str:
    result = call("generate_chat", {
        "messages_json": json.dumps(messages, ensure_ascii=False),
        "max_new_tokens": max_new_tokens,
        "temperature": 0.2,
        "think_tokens": 0,
    }, timeout=240)
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except json.JSONDecodeError:
            result = {"type": "text", "text": result}
    if not isinstance(result, dict) or result.get("type") != "text":
        raise RuntimeError(f"generate_chat did not return text: {str(result)[:300]}")
    answer = str(result.get("text") or "").strip()
    if not answer:
        raise RuntimeError("generate_chat returned an empty answer")
    return answer


def main() -> int:
    if not TOKEN:
        raise RuntimeError("MODELSCOPE_TOKEN is missing")
    if "sham-v1" in BASE.lower() or "nova-inference-server" in BASE.lower() or "coder-inference" in BASE.lower():
        raise RuntimeError("Refusing to test a non-v2 Studio URL")
    if "sham-v2-server" not in BASE.lower():
        raise RuntimeError("Refusing to test anything except Sham v2's dedicated primary Studio")

    status = None
    deadline = time.time() + 300
    while time.time() < deadline:
        status = call("status", {}, timeout=30)
        if isinstance(status, str):
            try:
                status = json.loads(status)
            except json.JSONDecodeError:
                status = {}
        context = int(status.get("context_tokens") or 0) if isinstance(status, dict) else 0
        if (isinstance(status, dict) and status.get("phase") == "ready"
                and status.get("model") == EXPECTED_MODEL and context >= 4096):
            break
        # The runtime-code publish and Studio restart are triggered by the same push.
        # Wait for the new worker instead of failing against the old ready worker.
        time.sleep(5)
    if not isinstance(status, dict) or status.get("phase") != "ready":
        raise RuntimeError(f"Sham v2 Studio is not ready: {json.dumps(status, ensure_ascii=False)[:500]}")
    if status.get("model") != EXPECTED_MODEL:
        raise RuntimeError(f"Wrong model in v2 Studio: {status.get('model')!r}")
    context = int(status.get("context_tokens") or 0)
    if context < 4096:
        raise RuntimeError(f"v2 context did not reach 4096 tokens before the 300s deadline (reported {context}); check the Studio deploy logs")

    identity = chat([{"role": "user", "content": "من أنت؟"}], 160)
    print(f"PASS Sham v2 model-authored identity response (wording unrestricted): {identity[:240]}")

    answer = chat([{"role": "user", "content": "ما عاصمة سوريا؟"}], 128)
    if answer.strip() == "ما عاصمة سوريا؟":
        raise RuntimeError("model returned the question verbatim")
    if "دمشق" not in answer:
        raise RuntimeError(f"model failed the Syria-capital smoke check: {answer[:240]!r}")
    print(f"PASS Sham v2 factual response: {answer[:300]}")

    followup = chat([
        {"role": "user", "content": "اسمي سارة."},
        {"role": "assistant", "content": "مرحباً سارة."},
        {"role": "user", "content": "ما اسمي؟"},
    ], 128)
    print(f"PASS Sham v2 multi-turn response: {followup[:240]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
