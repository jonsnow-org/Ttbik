"""
Calls Sham hosted on the ModelScope Studio (ai-system/modelscope-sham/app.py) with plain `requests`, using the protocol that was already proven
against this platform (see ai-system/app/council.py): POST {base}/gradio_api/call/v2/<api_name> with a JSON object keyed by the function's
parameter names -> {"event_id": ...}; GET {base}/gradio_api/call/<api_name>/<event_id> streams server-sent events whose `data:` line is a list.

The Studio is private: every call carries the account token as a Bearer header (env MODELSCOPE_API_TOKEN — a secret, never printed or logged).

    generate_text(prompt, max_new_tokens)  -> the model's text, or None when the Studio did not answer (the caller decides what to do)
    studio_status()                        -> the Studio's own status dict (phase/step/...), or None
    enabled()                              -> True when a token is configured
"""

from __future__ import annotations

import json
import os

import requests

DEFAULT_URL = "https://studio-novaai2026-nova-inference-server.api-inference.modelscope.net"
_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"


def _base() -> str:
    return (os.environ.get("SHAM_MODELSCOPE_URL") or DEFAULT_URL).rstrip("/")


def _token() -> str:
    return (os.environ.get("MODELSCOPE_API_TOKEN") or "").strip()


def enabled() -> bool:
    return bool(_token())


def _call(api_name: str, payload: dict, timeout: float = 120.0, post=requests.post, get=requests.get):
    headers = {"User-Agent": _UA, "Authorization": f"Bearer {_token()}"}
    base = _base()
    sub = post(f"{base}/gradio_api/call/v2/{api_name}", headers=headers, json=payload, timeout=30)
    sub.raise_for_status()
    event_id = sub.json()["event_id"]
    res = get(f"{base}/gradio_api/call/{api_name}/{event_id}", headers=headers, timeout=timeout, stream=True)
    res.raise_for_status()
    for line in res.iter_lines(decode_unicode=True):
        if line and line.startswith("data:"):
            data = json.loads(line[len("data:"):].strip())
            if isinstance(data, list) and data:
                return data[0]
    return None


def generate_text(prompt: str, max_new_tokens: int = 60, **kw) -> str | None:
    if not enabled():
        return None
    try:
        out = _call("generate_text", {"prompt": prompt, "max_new_tokens": max_new_tokens}, **kw)
        return str(out).strip() if out is not None else None
    except Exception:
        return None


def studio_status(**kw) -> dict | None:
    if not enabled():
        return None
    try:
        out = _call("status", {}, timeout=30, **kw)
        return json.loads(out) if isinstance(out, str) else out
    except Exception:
        return None


if __name__ == "__main__":
    os.environ.pop("MODELSCOPE_API_TOKEN", None)
    assert not enabled() and generate_text("x") is None and studio_status() is None        # no token: nothing is sent anywhere
    os.environ["MODELSCOPE_API_TOKEN"] = "unit-test-token"
    seen = {}

    class R:
        def __init__(self, body=None, lines=()):
            self._b, self._l = body, list(lines)

        def raise_for_status(self):
            pass

        def json(self):
            return self._b

        def iter_lines(self, decode_unicode=True):
            return iter(self._l)

    def fake_post(url, headers=None, json=None, timeout=None):
        seen.update(post_url=url, auth=headers.get("Authorization"), body=json)
        return R({"event_id": "abc123"})

    def fake_get(url, headers=None, timeout=None, stream=None):
        seen["get_url"] = url
        return R(lines=["event: complete", 'data: ["نص من شام"]'])

    assert generate_text("مرحبا", 40, post=fake_post, get=fake_get) == "نص من شام"
    assert seen["post_url"].endswith("/gradio_api/call/v2/generate_text") and seen["get_url"].endswith("/gradio_api/call/generate_text/abc123")
    assert seen["body"] == {"prompt": "مرحبا", "max_new_tokens": 40} and seen["auth"] == "Bearer unit-test-token"

    def boom(*a, **k):
        raise RuntimeError("network down")
    assert generate_text("x", post=boom, get=fake_get) is None                               # a failed call never raises into the bot
    stat_get = lambda url, headers=None, timeout=None, stream=None: R(lines=['data: ["{\\"phase\\": \\"ready\\", \\"step\\": 5}"]'])
    assert studio_status(post=fake_post, get=stat_get) == {"phase": "ready", "step": 5}
    print("studio_client self-test OK")
