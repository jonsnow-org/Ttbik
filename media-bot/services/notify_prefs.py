"""The bot side of notification settings. The settings themselves live on the site (they decide what the site sends); this talks
to /api/media-bot/notify-prefs with the same shared secret the other bot-to-site calls use. The bot knows who has the paid upgrade
and says so on every request; the site only applies "stop" for paid accounts."""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)
DEFAULT_SECRET = "8452320"

TYPE_LABELS = {
    "like": "الإعجابات",
    "comment": "التعليقات",
    "reply": "الردود",
    "follow": "المتابعون الجدد",
    "message": "الرسائل الخاصة",
    "post": "منشورات من تتابعهم",
}


def _secret() -> str:
    return (os.getenv("FEED_SECRET") or os.getenv("ADMIN_PASSWORD") or DEFAULT_SECRET).strip()


def _url() -> str:
    base = (os.getenv("FEED_API_URL") or "https://ttbik.vercel.app/api/media-feed").rstrip("/")
    return base.rsplit("/api/", 1)[0] + "/api/media-bot/notify-prefs"


async def call(user_id: int, action: str, ntype: str = "all", premium: bool = False) -> dict[str, Any] | None:
    """Returns the site's answer (always with `ok`), or None when the site could not be reached."""
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(
                _url(),
                json={"tgUserId": str(user_id), "action": action, "type": ntype, "premium": bool(premium)},
                headers={"x-feed-secret": _secret(), "content-type": "application/json"},
            )
            data = r.json() if r.content else {}
            if isinstance(data, dict):
                data.setdefault("ok", r.status_code < 400)
                data["status"] = r.status_code
                return data
    except Exception as e:
        logger.warning("notify prefs call failed: %s", e)
    return None
