#!/usr/bin/env python3
"""Read-only probe of the owner's SECOND ModelScope account on the international site (modelscope.ai).

Reads MODELSCOPE_AI_TOKEN from the environment (never printed). Prints: whether the token works, the account's user name, the free Studio hardware it may use, and the
Studios it already owns (names only). Changes nothing. Offline self-test: python modelscope_ai_probe.py --selftest
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

BASE = "https://www.modelscope.ai"
WHO_PATHS = ("/api/v1/users/info", "/api/v1/user", "/openapi/v1/users/me", "/api/v1/users/me")
NAME_KEYS = ("Name", "name", "Username", "username", "UserName", "user_name", "nick_name", "NickName", "display_name")


def call(path: str, token: str, timeout: int = 25):
    req = urllib.request.Request(BASE + path, headers={"Authorization": "Bearer " + token, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace") or "null")
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:  # network / JSON problems are reported, not raised
        return 0, str(type(e).__name__)


def find_names(obj, depth: int = 0) -> list[str]:
    """User-name-like fields anywhere in a small JSON answer (whitelisted keys, short strings only)."""
    out: list[str] = []
    if depth > 4:
        return out
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in NAME_KEYS and isinstance(v, str) and 0 < len(v) <= 64:
                out.append(f"{k}={v}")
            elif isinstance(v, (dict, list)):
                out += find_names(v, depth + 1)
    elif isinstance(obj, list):
        for v in obj[:5]:
            out += find_names(v, depth + 1)
    return out


def main() -> int:
    token = os.environ.get("T", "").strip()
    if not token:
        print("MODELSCOPE_AI_TOKEN is not set as a repository secret (or is empty).")
        return 1
    names: list[str] = []
    for p in WHO_PATHS:
        code, data = call(p, token)
        print(f"{p} -> HTTP {code}")
        if code == 200 and data is not None:
            names += find_names(data)
    print("account name fields:", sorted(set(names))[:8] or "none found")
    code, data = call("/openapi/v1/studios/hardware?sdk_type=gradio", token)
    hw = [h.get("name") for h in ((data or {}).get("data") or {}).get("hardware", [])] if isinstance(data, dict) else []
    print(f"studio hardware (HTTP {code}):", hw)
    for owner in sorted({n.split("=", 1)[1] for n in names}):
        code, data = call(f"/openapi/v1/studios?owner={owner}&status=all", token)
        studios = [s.get("id") for s in (((data or {}).get("data") or {}).get("studios") or [])] if isinstance(data, dict) else []
        print(f"studios of {owner} (HTTP {code}): {studios[:20]}")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        assert find_names({"Data": {"Name": "abc", "Email": "x@y"}}) == ["Name=abc"]
        assert find_names({"data": [{"username": "u1"}]}) == ["username=u1"]
        assert find_names({"a": {"b": {"c": {"d": {"e": {"name": "deep"}}}}}}) == []
        print("modelscope_ai_probe self-test OK")
        sys.exit(0)
    sys.exit(main())
