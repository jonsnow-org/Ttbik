"""Third-party media resolvers that work from datacenter IPs."""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)


async def tikwm_resolve(url: str) -> dict[str, Any] | None:
    """Resolve TikTok via tikwm.com — reliable from cloud IPs."""
    endpoints = [
        f"https://www.tikwm.com/api/?url={quote(url, safe='')}&hd=1",
        f"https://tikwm.com/api/?url={quote(url, safe='')}&hd=1",
    ]
    headers = {"User-Agent": UA, "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=35.0, follow_redirects=True, headers=headers) as client:
        for ep in endpoints:
            try:
                r = await client.get(ep)
                if r.status_code >= 400:
                    continue
                js = r.json()
                if js.get("code") != 0:
                    logger.warning("tikwm code=%s msg=%s", js.get("code"), js.get("msg"))
                    continue
                d = js.get("data") or {}
                play = d.get("hdplay") or d.get("play") or d.get("wmplay")
                music = d.get("music")
                if not play and not music:
                    continue
                author = d.get("author") or {}
                name = ""
                if isinstance(author, dict):
                    name = author.get("nickname") or author.get("unique_id") or ""
                return {
                    "video_url": play,
                    "audio_url": music,
                    "title": (d.get("title") or name or "TikTok")[:120],
                    "thumbnail": d.get("cover") or d.get("origin_cover") or "",
                    "duration": int(d.get("duration") or 0),
                    "source": "tikwm",
                }
            except Exception as e:
                logger.warning("tikwm failed: %s", e)
    return None


async def download_url_to_file(media_url: str, suffix: str = ".mp4") -> Path | None:
    headers = {
        "User-Agent": UA,
        "Referer": "https://www.tiktok.com/",
        "Accept": "*/*",
    }
    tmp = tempfile.mkdtemp(prefix="prov_")
    path = Path(tmp) / f"media{suffix}"
    try:
        async with httpx.AsyncClient(timeout=180.0, follow_redirects=True, headers=headers) as client:
            async with client.stream("GET", media_url) as r:
                if r.status_code >= 400:
                    logger.warning("media download HTTP %s", r.status_code)
                    return None
                with open(path, "wb") as f:
                    async for chunk in r.aiter_bytes(64 * 1024):
                        f.write(chunk)
        if path.stat().st_size < 1000:
            return None
        return path
    except Exception as e:
        logger.warning("download_url_to_file: %s", e)
        return None


async def provider_download_tiktok(
    url: str, *,
    audio_only: bool = False,
) -> tuple[Path | None, str, str | None, str]:
    """Returns (path, title, thumbnail, error)."""
    meta = await tikwm_resolve(url)
    if not meta:
        return None, "", None, "tikwm: resolve failed"

    media = meta.get("audio_url") if audio_only else meta.get("video_url")
    if audio_only and not media:
        media = meta.get("video_url")  # fallback
    if not media:
        return None, "", None, "tikwm: no media url"

    suffix = ".mp3" if audio_only else ".mp4"
    path = await download_url_to_file(media, suffix=suffix)
    if not path:
        return None, "", None, "tikwm: file download failed"

    return path, meta.get("title") or "TikTok", meta.get("thumbnail"), ""
