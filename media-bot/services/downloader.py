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

EXTRACT_TIMEOUT = 60
DOWNLOAD_TIMEOUT = 220

# Clients known to work better against YouTube bot-wall on cloud IPs (2026)
_YT_CLIENTS_PRIMARY = ["tv", "web_safari", "android", "mweb"]
_YT_CLIENTS_FALLBACK = ["web", "web_embedded", "ios"]


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
    u = re.sub(
        r"([?&])(fbclid|si|feature|utm_[^=]+|pp)=[^&]*",
        r"\1",
        u,
        flags=re.I,
    )
    u = u.replace("?&", "?").rstrip("?&")

    m = re.search(r"youtube\.com/shorts/([\w-]{6,})", u, re.I)
    if m:
        return f"https://www.youtube.com/watch?v={m.group(1)}"

    m = re.search(r"youtu\.be/([\w-]{6,})", u, re.I)
    if m:
        return f"https://www.youtube.com/watch?v={m.group(1)}"

    m = re.search(r"youtube\.com/watch\?v=([\w-]{6,})", u, re.I)
    if m:
        return f"https://www.youtube.com/watch?v={m.group(1)}"

    return u


def _base_opts(outdir: str | None = None, clients: list[str] | None = None) -> dict[str, Any]:
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
        # Prefer IPv4 — many cloud IPv6 ranges are flagged by YouTube
        "source_address": "0.0.0.0",
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9,ar;q=0.8",
        },
        "extractor_args": {
            "youtube": {
                "player_client": clients or _YT_CLIENTS_PRIMARY,
            }
        },
    }
    # Optional cookies file for YouTube bot-wall (upload cookies.txt on Render if needed)
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

    for clients in (_YT_CLIENTS_PRIMARY, _YT_CLIENTS_FALLBACK):
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
            logger.error("extract_info timeout clients=%s url=%s", clients, url[:60])
            last_err = TimeoutError("timeout")
        except Exception as e:
            logger.warning("extract_info clients=%s failed: %s", clients, e)
            last_err = e

    logger.error("extract_info all clients failed for %s: %s", url[:80], last_err)
    return None


async def download_media(
    url: str,
    quality: str = "720",
    media_type: str = "video",
) -> DownloadResult | None:
    url = normalize_url(url)
    tmp = tempfile.mkdtemp(prefix="mediabot_")
    last_err: Exception | None = None

    for clients in (_YT_CLIENTS_PRIMARY, _YT_CLIENTS_FALLBACK):
        try:
            import yt_dlp

            opts = _base_opts(tmp, clients=clients)

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
                logger.error("No output file after download clients=%s", clients)
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

    logger.error("download_media all clients failed for %s: %s", url[:80], last_err)
    return None
