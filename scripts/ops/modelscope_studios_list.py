#!/usr/bin/env python3
"""Read-only list of the Studios of one ModelScope account (site cn = novaai2026 on modelscope.cn, site ai = the international account on modelscope.ai): name, status, hardware.

Reads the token from the environment (T, never printed). Changes nothing. Offline self-test: python modelscope_studios_list.py --selftest
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

SITES = {"cn": ("https://www.modelscope.cn", "novaai2026"), "ai": ("https://www.modelscope.ai", "")}
WHO_PATHS = ("/api/v1/users/info", "/api/v1/user", "/openapi/v1/users/me", "/api/v1/users/me")
NAME_KEYS = ("Name", "name", "Username", "username", "UserName", "user_name")


def call(base: str, path: str, token: str):
    req = urllib.request.Request(base + path, headers={"Authorization": "Bearer " + token, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode("utf-8", "replace") or "null")
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:  # noqa: BLE001
        return 0, str(type(e).__name__)


def names_in(obj, depth: int = 0) -> list[str]:
    out: list[str] = []
    if depth > 4:
        return out
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in NAME_KEYS and isinstance(v, str) and 0 < len(v) <= 64:
                out.append(v)
            elif isinstance(v, (dict, list)):
                out += names_in(v, depth + 1)
    elif isinstance(obj, list):
        for v in obj[:5]:
            out += names_in(v, depth + 1)
    return out


def main() -> int:
    site = os.environ.get("SITE", "cn")
    base, owner = SITES[site]
    token = os.environ.get("T", "").strip()
    if not token:
        print("no token in the environment")
        return 1
    owners = [owner] if owner else []
    if not owners:
        for p in WHO_PATHS:
            c, d = call(base, p, token)
            if c == 200 and d is not None:
                owners += names_in(d)
        owners = sorted(set(owners))[:2]
    print(f"site {site}: owners {owners}")
    for o in owners:
        c, d = call(base, f"/openapi/v1/studios?owner={o}&status=all", token)
        studios = (((d or {}).get("data") or {}).get("studios") or []) if isinstance(d, dict) else []
        print(f"{o}: HTTP {c}, {len(studios)} Studios")
        for s in studios[:60]:
            sid = s.get("id") or s.get("name")
            c2, d2 = call(base, f"/openapi/v1/studios/{sid}", token)
            data = ((d2 or {}).get("data") or {}) if isinstance(d2, dict) else {}
            rt = data.get("runtime") or {}
            print(f"- {sid}: status={rt.get('status')} hardware={data.get('hardware')} visibility={data.get('visibility')}")
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        assert names_in({"Data": {"Name": "abc", "Email": "x@y"}}) == ["abc"]
        print("modelscope_studios_list self-test OK")
        sys.exit(0)
    sys.exit(main())
