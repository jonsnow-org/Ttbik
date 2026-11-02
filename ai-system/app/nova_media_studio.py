"""Client for Nova's dedicated ModelScope media Studio.

This module belongs only to Nova. It does not call either Sham Studio.
The Studio provides SDXS images, Piper speech, and native AnimateDiff-Lightning video diffusion on CPU using Nova's own local open weights.
"""
from __future__ import annotations

import base64
import json
import logging
import os

import requests

from app.media_quality import MediaQualityError, check_image, check_mp4, check_wav

logger = logging.getLogger(__name__)
DEFAULT_URL = "https://studio-novaai2026-nova-media-server.api-inference.modelscope.net"


def _parse_sse(body: str) -> dict | None:
    for line in (body or "").splitlines():
        if not line.startswith("data:"):
            continue
        try:
            value = json.loads(line[5:].strip())
            value = value[0] if isinstance(value, list) and value else value
            if isinstance(value, str):
                value = json.loads(value)
            if isinstance(value, dict):
                return value
        except (ValueError, TypeError, json.JSONDecodeError):
            continue
    return None


def generate_media(
    kind: str,
    prompt: str,
    *,
    scenes: list[str] | None = None,
    narration: str = "",
    seconds: int = 2,
    timeout: int = 900,
) -> bytes | None:
    """Generate media on Nova's own Studio; return bytes or None on a real error."""
    selected = (kind or "").strip().lower()
    api = {"image": "image", "audio": "speech", "video": "video"}.get(selected)
    if not api:
        return None
    base = (os.environ.get("NOVA_MEDIA_STUDIO_URL") or DEFAULT_URL).strip().rstrip("/")
    token = (os.environ.get("OPEN_CODER_STUDIO_TOKEN") or os.environ.get("MODELSCOPE_API_TOKEN") or "").strip()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if selected == "image":
        payload = {"prompt": (prompt or "")[:400], "size": 512, "seed": 0}
    elif selected == "audio":
        payload = {"text": (prompt or "")[:1500]}
    else:
        payload = {
            "prompt": (prompt or "")[:800],
            "seconds": max(1, min(int(seconds or 2), 2)),
            "seed": 0,
        }
    try:
        submit = requests.post(
            f"{base}/gradio_api/call/v2/{api}",
            headers=headers,
            json={"body": json.dumps(payload, ensure_ascii=False)},
            timeout=30,
        )
        submit.raise_for_status()
        event_id = (submit.json() or {}).get("event_id")
        if not event_id:
            logger.warning("Nova media Studio returned no event id for %s", selected)
            return None
        result = requests.get(
            f"{base}/gradio_api/call/{api}/{event_id}",
            headers=headers,
            timeout=max(30, min(int(timeout), 900)),
        )
        result.raise_for_status()
        body = _parse_sse(result.text)
        if not body or body.get("type") != selected or not body.get("b64"):
            logger.warning("Nova media Studio returned no usable %s payload: %s", selected, (body or {}).get("text", "unreadable response")[:180])
            return None
        raw = base64.b64decode(body["b64"], validate=False)
        if len(raw) < 64:
            logger.warning("Nova media Studio returned a suspiciously small %s payload (%d bytes)", selected, len(raw))
            return None
        try:        # defence in depth: the Studio already vets what it returns; an older Studio might not
            (lambda b: check_mp4(b, decode=False))(raw) if selected == "video" else {"image": check_image, "audio": check_wav}[selected](raw)   # the Studio decodes video frames; this side checks the MP4 structure only
        except MediaQualityError as exc:
            logger.warning("Nova media Studio %s rejected by the quality gate (%s)", selected, exc.reason)
            return None
        logger.info("Nova media Studio generated %s (%d bytes)", selected, len(raw))
        return raw
    except Exception as exc:
        logger.warning("Nova media Studio %s failed (%s: %s)", selected, type(exc).__name__, str(exc)[:160])
        return None
