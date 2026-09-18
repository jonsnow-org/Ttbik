"""Publish shared downloads to Mini App feed API + local cache for one-click clone."""

from __future__ import annotations

import logging
import os
import time
import uuid
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_local_feed: list[dict[str, Any]] = []


def local_items(limit: int = 50) -> list[dict[str, Any]]:
    return list(_local_feed[:limit])


def find_local(item_id: str) -> dict[str, Any] | None:
    for it in _local_feed:
        if it.get("id") == item_id:
            return it
    return None


def remember_local(item: dict[str, Any]) -> None:
    _local_feed.insert(0, item)
    del _local_feed[200:]


async def publish_feed_item(
    *,
    file_id: str,
    media_type: str,
    title: str,
    url: str,
    thumbnail: str | None,
    sharer_name: str,
    sharer_id: str,
) -> dict[str, Any] | None:
    item = {
        "id": uuid.uuid4().hex[:12],
        "file_id": file_id,
        "media_type": media_type,
        "title": (title or "بدون عنوان")[:120],
        "url": url,
        "thumbnail": thumbnail or "",
        "sharer_name": (sharer_name or "مستخدم")[:40],
        "sharer_id": str(sharer_id),
        "clones": 0,
        "created_at": int(time.time()),
    }
    remember_local(item)

    api = (os.getenv("FEED_API_URL") or "https://ttbik.vercel.app/api/media-feed").rstrip("/")
    secret = (os.getenv("FEED_SECRET") or os.getenv("ADMIN_PASSWORD") or "").strip()
    if not secret:
        logger.warning("FEED_SECRET missing — item kept only in bot memory")
        return item

    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.post(
                api,
                json=item,
                headers={"x-feed-secret": secret, "content-type": "application/json"},
            )
            if r.status_code >= 400:
                logger.warning("feed API %s: %s", r.status_code, r.text[:200])
            else:
                data = r.json()
                if isinstance(data, dict) and data.get("id"):
                    item["id"] = data["id"]
    except Exception as e:
        logger.warning("feed publish failed: %s", e)

    return item
