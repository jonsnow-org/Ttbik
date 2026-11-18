"""Shared ModelScope hub host selection (modelscope.cn vs the international modelscope.ai).

The SDK default is modelscope.cn. The international account's token (SITE=ai, owner Jonjithup, or an
explicit MODELSCOPE_DOMAIN / MODELSCOPE_HUB_ENDPOINT) must talk to www.modelscope.ai, or publishes
and snapshot_download calls fail silently (published=False).

Used by sham_inputs.publish_modelscope and by the Studio trainer (call apply_ms_hub_endpoint() before
HubApi / snapshot_download, including from sham2_donor).
"""
from __future__ import annotations

import os


def ms_hub_endpoint() -> str | None:
    raw = (os.environ.get("MODELSCOPE_DOMAIN") or os.environ.get("MODELSCOPE_HUB_ENDPOINT") or "").strip()
    if raw:
        return raw.replace("https://", "").replace("http://", "").strip("/") or None
    if (os.environ.get("SITE") or "").strip().lower() == "ai":
        return "www.modelscope.ai"
    if (os.environ.get("SHAM_MS_OWNER") or os.environ.get("MS_OWNER") or "").strip().lower() == "jonjithup":
        return "www.modelscope.ai"
    return None


def apply_ms_hub_endpoint() -> str | None:
    endpoint = ms_hub_endpoint()
    if endpoint:
        os.environ["MODELSCOPE_DOMAIN"] = endpoint
    return endpoint
