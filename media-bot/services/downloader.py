"""
yt-dlp wrapper for Media Download Bot.
Keeps downloads under free-tier friendly limits by default.
"""

from __future__ import annotations

import asyncio
import logging
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Default max size we try to stay under for standard Bot API (~50MB)
MAX_SAFE_BYTES = 48 * 1024 * 1024


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
    media_type: str  # video | audio | voice
    filesize: int


def _base_opts(outdir: str) -> dict[str, Any]:
    return {
        "outtmpl": os.path.join(outdir, "%(id)s.%(ext)s"),
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "restrictfilenames": True,
        "noplaylist": True,
        "socket_timeout": 30,
        "retries": 2,
    }


async def extract_info(url: str) -> MediaInfo | None:
    """Fetch metadata without downloading."""
    try:
        import yt_dlp

        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "noplaylist": True,
        }

        def _run() -> dict:
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(url, download=False)

        info = await asyncio.to_thread(_run)
        if not info:
            return None

        return MediaInfo(
            title=info.get("title") or "بدون عنوان",
            duration=info.get("duration"),
            thumbnail=info.get("thumbnail"),
            webpage_url=info.get("webpage_url") or url,
            extractor=info.get("extractor") or "unknown",
        )
    except Exception as e:
        logger.exception("extract_info failed: %s", e)
        return None


async def download_media(
    url: str,
    quality: str = "720",
    media_type: str = "video",
) -> DownloadResult | None:
    """
    Download media to a temp directory.
    quality: 360 | 480 | 720 | best
    media_type: video | audio | voice
    """
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
            # Prefer mp4 under size-ish limits
            format_map = {
                "360": "bestvideo[height<=360][ext=mp4]+bestaudio[ext=m4a]/best[height<=360][ext=mp4]/best[height<=360]",
                "480": "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[height<=480]",
                "720": "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]",
            }
            opts["format"] = format_map.get(quality, format_map["720"])
            opts["merge_output_format"] = "mp4"

        def _run() -> dict:
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(url, download=True)

        info = await asyncio.to_thread(_run)
        if not info:
            return None

        # Locate the produced file
        filepath = None
        if "requested_downloads" in info and info["requested_downloads"]:
            filepath = info["requested_downloads"][0].get("filepath")
        if not filepath:
            # fallback: first file in tmp
            files = list(Path(tmp).glob("*"))
            if files:
                filepath = str(files[0])

        if not filepath or not os.path.isfile(filepath):
            logger.error("No output file after download")
            return None

        path = Path(filepath)
        size = path.stat().st_size

        return DownloadResult(
            path=path,
            title=info.get("title") or path.stem,
            media_type=media_type,
            filesize=size,
        )
    except Exception as e:
        logger.exception("download_media failed: %s", e)
        return None
