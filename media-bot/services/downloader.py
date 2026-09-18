"""yt-dlp wrapper with hard timeouts so the bot never hangs on a link."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

MAX_SAFE_BYTES = 48 * 1024 * 1024
EXTRACT_TIMEOUT = 55
DOWNLOAD_TIMEOUT = 200


@dataclass
class MediaInfo:
    title: str
    duration: int | None
    thumbnail: str | None
    webpage_url: str
    extractor: str


@dataclass
class DownloadResult:
    path: Path
    title: str
    media_type: str
    filesize: int
    thumbnail: str | None = None


def normalize_url(url: str) -> str:
    """Normalize share redirects that break yt-dlp."""
    u = (url or "").strip()
    # Strip common tracking params
    u = re.sub(
        r"([?&])(fbclid|si|feature|utm_[^=]+|pp)=[^&]*",
        r"\1",
        u,
        flags=re.I,
    )
    u = u.replace("?&", "?").rstrip("?&")

    # YouTube Shorts → watch URL (more reliable)
    m = re.search(r"(?:youtube\.com/shorts/|youtu\.be/)([\w-]{6,})", u, re.I)
    if m and "shorts" in u.lower():
        u = f"https://www.youtube.com/watch?v={m.group(1)}"

    # youtu.be short
    m = re.search(r"youtu\.be/([\w-]{6,})", u, re.I)
    if m and "youtube.com/watch" not in u:
        u = f"https://www.youtube.com/watch?v={m.group(1)}"

    # TikTok vm/vt short links stay as-is (yt-dlp resolves them)
    return u


def _base_opts(outdir: str | None = None) -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "restrictfilenames": True,
        "noplaylist": True,
        "socket_timeout": 30,
        "retries": 3,
        "extractor_retries": 3,
        "fragment_retries": 3,
        "ignoreerrors": False,
        "geo_bypass": True,
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
        },
        # Help YouTube / age-gated / SABR issues on cloud IPs
        "extractor_args": {
            "youtube": {
                "player_client": ["android", "web", "ios"],
                "player_skip": ["webpage", "configs"],
            }
        },
    }
    if outdir:
        opts["outtmpl"] = os.path.join(outdir, "%(id)s.%(ext)s")
    return opts


async def extract_info(url: str) -> MediaInfo | None:
    url = normalize_url(url)
    try:
        import yt_dlp

        opts = _base_opts()
        opts["skip_download"] = True

        def _run() -> dict | None:
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(url, download=False)

        info = await asyncio.wait_for(asyncio.to_thread(_run), timeout=EXTRACT_TIMEOUT)
        if not info:
            return None

        return MediaInfo(
            title=info.get("title") or "بدون عنوان",
            duration=info.get("duration"),
            thumbnail=info.get("thumbnail"),
            webpage_url=info.get("webpage_url") or url,
            extractor=info.get("extractor") or "unknown",
        )
    except asyncio.TimeoutError:
        logger.error("extract_info timeout for %s", url[:80])
        return None
    except Exception as e:
        logger.error("extract_info failed for %s: %s", url[:80], e)
        return None


async def download_media(
    url: str,
    quality: str = "720",
    media_type: str = "video",
) -> DownloadResult | None:
    url = normalize_url(url)
    tmp = tempfile.mkdtemp(prefix="mediabot_")
    try:
        import yt_dlp

        opts = _base_opts(tmp)

        if media_type in ("audio", "voice"):
            opts.update(
                {
                    "format": "bestaudio/best",
                    "postprocessors": [
                        {
                            "key": "FFmpegExtractAudio",
                            "preferredcodec": "mp3" if media_type == "audio" else "opus",
                            "preferredquality": "192",
                        }
                    ],
                }
            )
        else:
            format_map = {
                "360": "bestvideo[height<=360]+bestaudio/best[height<=360]/best",
                "480": "bestvideo[height<=480]+bestaudio/best[height<=480]/best",
                "720": "bestvideo[height<=720]+bestaudio/best[height<=720]/best",
            }
            opts["format"] = format_map.get(quality, format_map["720"])
            opts["merge_output_format"] = "mp4"

        def _run() -> dict | None:
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(url, download=True)

        info = await asyncio.wait_for(asyncio.to_thread(_run), timeout=DOWNLOAD_TIMEOUT)
        if not info:
            return None

        filepath = None
        if "requested_downloads" in info and info["requested_downloads"]:
            filepath = info["requested_downloads"][0].get("filepath")
        if not filepath:
            files = sorted(Path(tmp).glob("*"), key=lambda p: p.stat().st_mtime, reverse=True)
            files = [f for f in files if f.is_file() and not f.name.endswith(".part")]
            if files:
                filepath = str(files[0])

        if not filepath or not os.path.isfile(filepath):
            logger.error("No output file after download")
            return None

        path = Path(filepath)
        return DownloadResult(
            path=path,
            title=info.get("title") or path.stem,
            media_type=media_type,
            filesize=path.stat().st_size,
            thumbnail=info.get("thumbnail"),
        )
    except asyncio.TimeoutError:
        logger.error("download_media timeout for %s", url[:80])
        return None
    except Exception as e:
        logger.error("download_media failed for %s: %s", url[:80], e)
        return None
