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
DEFAULT_SECRET = "8452320"


def _secret() -> str:
    return (os.getenv("FEED_SECRET") or os.getenv("ADMIN_PASSWORD") or DEFAULT_SECRET).strip()


def _api_url() -> str:
    return (os.getenv("FEED_API_URL") or "https://ttbik.vercel.app/api/media-feed").rstrip("/")


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
    tags: list[str] | None = None,
    squad_code: str | None = None,
) -> dict[str, Any] | None:
    item: dict[str, Any] = {
        "id": uuid.uuid4().hex[:12],
        "file_id": file_id,
        "media_type": media_type,
        "title": (title or "بدون عنوان")[:120],
        "url": url,
        "thumbnail": thumbnail or "",
        "sharer_name": (sharer_name or "مستخدم")[:40],
        "sharer_id": str(sharer_id),
        "clones": 0,
        "tags": tags or ["عام"],
        "squad_code": squad_code or "",
        "created_at": int(time.time()),
    }
    remember_local(item)

    api = _api_url()
    secret = _secret()
    logger.info("Publishing feed item to %s id=%s sharer=%s", api, item["id"], sharer_id)

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(
                api,
                json=item,
                headers={"x-feed-secret": secret, "content-type": "application/json"},
            )
            logger.info("feed API status=%s body=%s", r.status_code, r.text[:300])
            if r.status_code >= 400:
                # retry without optional fields (older table schema)
                minimal = {
                    "id": item["id"],
                    "file_id": item["file_id"],
                    "media_type": item["media_type"],
                    "title": item["title"],
                    "url": item["url"],
                    "thumbnail": item["thumbnail"],
                    "sharer_name": item["sharer_name"],
                    "sharer_id": item["sharer_id"],
                    "clones": 0,
                    "created_at": item["created_at"],
                }
                r2 = await client.post(
                    api,
                    json=minimal,
                    headers={"x-feed-secret": secret, "content-type": "application/json"},
                )
                logger.info("feed API retry status=%s body=%s", r2.status_code, r2.text[:300])
                if r2.status_code < 400:
                    data = r2.json()
                    if isinstance(data, dict) and data.get("id"):
                        item["id"] = data["id"]
            else:
                data = r.json()
                if isinstance(data, dict) and data.get("id"):
                    item["id"] = data["id"]
    except Exception as e:
        logger.warning("feed publish failed: %s", e)

    return item


async def increment_clone(item_id: str) -> None:
    api = _api_url()
    secret = _secret()
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            await client.patch(
                api,
                json={"id": item_id, "action": "clone"},
                headers={"x-feed-secret": secret, "content-type": "application/json"},
            )
    except Exception as e:
        logger.warning("clone increment failed: %s", e)
