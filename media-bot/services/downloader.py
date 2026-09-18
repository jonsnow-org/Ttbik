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

EXTRACT_TIMEOUT = 70
DOWNLOAD_TIMEOUT = 240

# 2026 cloud-IP friendly order (try one client group at a time)
_YT_CLIENT_GROUPS = [
    ["android", "android_vr"],
    ["tv", "tv_embedded"],
    ["web_safari", "mweb"],
    ["web", "web_embedded"],
]


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
    u = (url or "").strip()
    # strip tracking
    u = re.sub(r"([?&])(fbclid|si|feature|utm_[^=]+|pp|t)=[^&]*", r"\1", u, flags=re.I)
    u = u.replace("?&", "?").rstrip("?&")

    m = re.search(r"(?:youtube\.com/shorts/|youtube\.com/embed/|youtu\.be/)([\w-]{6,})", u, re.I)
    if m:
        return f"https://www.youtube.com/watch?v={m.group(1)}"

    m = re.search(r"[?&]v=([\w-]{6,})", u, re.I)
    if m and "youtube" in u.lower():
        return f"https://www.youtube.com/watch?v={m.group(1)}"

    return u


def _base_opts(outdir: str | None = None, clients: list[str] | None = None) -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "restrictfilenames": True,
        "noplaylist": True,
        "socket_timeout": 35,
        "retries": 5,
        "extractor_retries": 3,
        "fragment_retries": 5,
        "ignoreerrors": False,
        "geo_bypass": True,
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Linux; Android 13; Pixel 7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Mobile Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
        },
        "extractor_args": {
            "youtube": {
                "player_client": clients or ["android", "tv"],
            }
        },
    }
    cookies = (os.getenv("YTDLP_COOKIES") or "").strip()
    if cookies and os.path.isfile(cookies):
        opts["cookiefile"] = cookies

    if outdir:
        opts["outtmpl"] = os.path.join(outdir, "%(id)s.%(ext)s")
    return opts


def _extract_once(url: str, clients: list[str]) -> dict | None:
    import yt_dlp

    opts = _base_opts(clients=clients)
    opts["skip_download"] = True
    with yt_dlp.YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=False)


async def extract_info(url: str) -> MediaInfo | None:
    url = normalize_url(url)
    last_err: Exception | None = None
    is_yt = "youtu" in url.lower()

    groups = _YT_CLIENT_GROUPS if is_yt else [["web"]]

    for clients in groups:
        try:

            def _run() -> dict | None:
                return _extract_once(url, clients)

            info = await asyncio.wait_for(asyncio.to_thread(_run), timeout=EXTRACT_TIMEOUT)
            if not info:
                continue
            return MediaInfo(
                title=info.get("title") or "بدون عنوان",
                duration=info.get("duration"),
                thumbnail=info.get("thumbnail"),
                webpage_url=info.get("webpage_url") or url,
                extractor=info.get("extractor") or "unknown",
            )
        except asyncio.TimeoutError:
            logger.error("extract_info timeout clients=%s", clients)
            last_err = TimeoutError("timeout")
        except Exception as e:
            logger.warning("extract_info clients=%s failed: %s", clients, e)
            last_err = e

    # Non-youtube single attempt with default extractor
    if not is_yt:
        try:
            import yt_dlp

            def _run2() -> dict | None:
                opts = _base_opts()
                opts["skip_download"] = True
                opts.pop("extractor_args", None)
                with yt_dlp.YoutubeDL(opts) as ydl:
                    return ydl.extract_info(url, download=False)

            info = await asyncio.wait_for(asyncio.to_thread(_run2), timeout=EXTRACT_TIMEOUT)
            if info:
                return MediaInfo(
                    title=info.get("title") or "بدون عنوان",
                    duration=info.get("duration"),
                    thumbnail=info.get("thumbnail"),
                    webpage_url=info.get("webpage_url") or url,
                    extractor=info.get("extractor") or "unknown",
                )
        except Exception as e:
            last_err = e

    logger.error("extract_info failed for %s: %s", url[:80], last_err)
    return None


async def download_media(
    url: str,
    quality: str = "720",
    media_type: str = "video",
) -> DownloadResult | None:
    url = normalize_url(url)
    tmp = tempfile.mkdtemp(prefix="mediabot_")
    last_err: Exception | None = None
    is_yt = "youtu" in url.lower()
    groups = _YT_CLIENT_GROUPS if is_yt else [["web"]]

    for clients in groups:
        try:
            import yt_dlp

            opts = _base_opts(tmp, clients=clients)
            if not is_yt:
                opts.pop("extractor_args", None)

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
                # Prefer progressive single-file formats first (no ffmpeg merge needed)
                format_map = {
                    "360": "best[height<=360]/bestvideo[height<=360]+bestaudio/best",
                    "480": "best[height<=480]/bestvideo[height<=480]+bestaudio/best",
                    "720": "best[height<=720]/bestvideo[height<=720]+bestaudio/best",
                }
                opts["format"] = format_map.get(quality, format_map["720"])
                opts["merge_output_format"] = "mp4"

            def _run() -> dict | None:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    return ydl.extract_info(url, download=True)

            info = await asyncio.wait_for(asyncio.to_thread(_run), timeout=DOWNLOAD_TIMEOUT)
            if not info:
                continue

            filepath = None
            if "requested_downloads" in info and info["requested_downloads"]:
                filepath = info["requested_downloads"][0].get("filepath")
            if not filepath:
                files = sorted(Path(tmp).glob("*"), key=lambda p: p.stat().st_mtime, reverse=True)
                files = [f for f in files if f.is_file() and not f.name.endswith(".part")]
                if files:
                    filepath = str(files[0])

            if not filepath or not os.path.isfile(filepath):
                logger.error("No output file clients=%s", clients)
                continue

            path = Path(filepath)
            return DownloadResult(
                path=path,
                title=info.get("title") or path.stem,
                media_type=media_type,
                filesize=path.stat().st_size,
                thumbnail=info.get("thumbnail"),
            )
        except asyncio.TimeoutError:
            logger.error("download timeout clients=%s", clients)
            last_err = TimeoutError("timeout")
        except Exception as e:
            logger.warning("download clients=%s failed: %s", clients, e)
            last_err = e

    logger.error("download_media failed for %s: %s", url[:80], last_err)
    return None
