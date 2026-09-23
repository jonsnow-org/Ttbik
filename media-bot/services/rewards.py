"""Rewarded-ad bonus downloads, granted in the mini-app (/api/media-reward).

The bot asks the site for the user's bonus for today (UTC) right before a
download, caches it for a minute, and Store.daily_limit adds it on top of
the normal free/share/premium limit.
"""

from __future__ import annotations

import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)

_cache: dict[int, tuple[float, int]] = {}
CACHE_SECONDS = 60


def _url() -> str:
    feed = (os.getenv("FEED_API_URL") or "https://ttbik.vercel.app/api/media-feed").rstrip("/")
    return feed.rsplit("/", 1)[0] + "/media-reward"


def _secret() -> str:
    return (os.getenv("FEED_SECRET") or os.getenv("ADMIN_PASSWORD") or "8452320").strip()


async def refresh_bonus(store, user_id: int) -> int:
    """Fetch today's ad bonus for user_id into store.ad_bonus; never raises."""
    now = time.time()
    hit = _cache.get(user_id)
    if hit and now - hit[0] < CACHE_SECONDS:
        store.set_ad_bonus(user_id, hit[1])
        return hit[1]
    bonus = 0
    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            r = await client.get(_url(), params={"user_id": str(user_id)}, headers={"x-feed-secret": _secret()})
            if r.status_code == 200:
                bonus = int((r.json() or {}).get("bonus") or 0)
    except Exception as e:  # network hiccup: keep whatever we had
        logger.info("ad bonus fetch failed: %s", e)
        bonus = hit[1] if hit else 0
    _cache[user_id] = (now, bonus)
    store.set_ad_bonus(user_id, bonus)
    return bonus
