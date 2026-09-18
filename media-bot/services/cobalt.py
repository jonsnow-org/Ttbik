"""Fallback downloader via public Cobalt community instances.

Render/datacenter IPs are often blocked by YouTube (bot check) and TikTok
(status 0). Cobalt instances resolve media URLs server-side with better IP
reputation / browser fingerprinting.
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Community instances (no official api.cobalt.tools — bot-protected).
# Order: prefer ones that scored high on cobalt.directory.
_DEFAULT_INSTANCES = [
    "https://cobalt-alpha.wolfy.love",
    "https://apicobalt.mgytr.top",
    "https://api.qwkuns.me",
    "https://api.cobalt.rpkiinval.id",
    "https://nuko-c.meowing.de",
]


def _instances() -> list[str]:
    custom = (os.getenv("COBALT_API_URL") or "").strip()
    if custom:
        return [custom.rstrip("/")] + [i for i in _DEFAULT_INSTANCES if i != custom.rstrip("/")]
    return list(_DEFAULT_INSTANCES)


async def cobalt_resolve(
    url: str,
    *,
    quality: str = "720",
    audio_only: bool = False,
) -> dict[str, Any] | None:
    """Ask Cobalt for a direct media URL. Returns {url, filename, is_audio} or None."""
    q_map = {"360": "360", "480": "480", "720": "720", "best": "1080"}
    body: dict[str, Any] = {
        "url": url,
        "videoQuality": q_map.get(quality, "720"),
        "downloadMode": "audio" if audio_only else "auto",
        "audioFormat": "mp3" if audio_only else "best",
        "filenameStyle": "basic",
    }
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; MediaBot/1.0)",
    }

    async with httpx.AsyncClient(timeout=45.0, follow_redirects=True) as client:
        for base in _instances():
            try:
                r = await client.post(f"{base}/", json=body, headers=headers)
                if r.status_code >= 400:
                    logger.warning("cobalt %s status=%s body=%s", base, r.status_code, r.text[:200])
                    continue
                data = r.json()
                status = data.get("status")
                # tunnel / redirect / stream
                if status in ("tunnel", "redirect", "stream", "success", "picker"):
                    media_url = data.get("url") or data.get("tunnel")
                    if status == "picker" and data.get("picker"):
                        # pick first video-like item
                        for item in data["picker"]:
                            if item.get("url"):
                                media_url = item["url"]
                                break
                    if not media_url:
                        continue
                    return {
                        "url": media_url,
                        "filename": data.get("filename") or "media.mp4",
                        "is_audio": audio_only or data.get("isAudio", False),
                        "source": base,
                    }
                logger.warning("cobalt %s unexpected: %s", base, str(data)[:200])
            except Exception as e:
                logger.warning("cobalt %s failed: %s", base, e)
    return None


async def cobalt_download_to_file(
    url: str,
    *,
    quality: str = "720",
    audio_only: bool = False,
) -> tuple[Path | None, str, str]:
    """Download via Cobalt → temp file. Returns (path, title, error)."""
    meta = await cobalt_resolve(url, quality=quality, audio_only=audio_only)
    if not meta:
        return None, "", "cobalt: all instances failed"

    media_url = meta["url"]
    filename = meta.get("filename") or ("audio.mp3" if audio_only else "video.mp4")
    # sanitize
    filename = "".join(c if c.isalnum() or c in ".-_" else "_" for c in filename)[:80]

    tmp = tempfile.mkdtemp(prefix="cobalt_")
    path = Path(tmp) / filename

    try:
        async with httpx.AsyncClient(timeout=180.0, follow_redirects=True) as client:
            async with client.stream("GET", media_url) as r:
                if r.status_code >= 400:
                    return None, "", f"cobalt download HTTP {r.status_code}"
                with open(path, "wb") as f:
                    async for chunk in r.aiter_bytes(64 * 1024):
                        f.write(chunk)
        if not path.is_file() or path.stat().st_size < 1000:
            return None, "", "cobalt: file too small"
        title = Path(filename).stem.replace("_", " ")
        logger.info("cobalt OK via %s size=%s", meta.get("source"), path.stat().st_size)
        return path, title, ""
    except Exception as e:
        logger.warning("cobalt file download failed: %s", e)
        return None, "", str(e)
