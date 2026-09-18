"""yt-dlp wrapper — TikTok/generic path is fully separate from YouTube clients."""

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

EXTRACT_TIMEOUT = 55
DOWNLOAD_TIMEOUT = 200

# YouTube only — never applied to TikTok/IG/etc
_YT_CLIENT_GROUPS = [
    ["android"],
    ["tv"],
    ["web_safari"],
    ["mweb"],
    ["web"],
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


def is_youtube(url: str) -> bool:
    return bool(re.search(r"(youtube\.com|youtu\.be)", url or "", re.I))


def is_tiktok(url: str) -> bool:
    return bool(re.search(r"(tiktok\.com|vm\.tiktok|vt\.tiktok)", url or "", re.I))


def normalize_url(url: str) -> str:
    u = (url or "").strip()
    # strip tracking query junk
    u = re.sub(r"([?&])(fbclid|si|feature|utm_[^=]+|pp)=[^&]*", r"\1", u, flags=re.I)
    u = u.replace("?&", "?").rstrip("?&")
    u = u.rstrip("/")

    # YouTube Shorts / share → clean watch URL
    m = re.search(r"(?:youtube\.com/shorts/|youtube\.com/embed/|youtu\.be/)([\w-]{6,})", u, re.I)
    if m:
        return f"https://www.youtube.com/watch?v={m.group(1)}"

    m = re.search(r"[?&]v=([\w-]{6,})", u, re.I)
    if m and "youtu" in u.lower():
        return f"https://www.youtube.com/watch?v={m.group(1)}"

    return u


async def resolve_redirects(url: str) -> str:
    """Follow short-link redirects (TikTok vt/vm) so yt-dlp gets a final URL."""
    try:
        import httpx

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
            )
        }
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=15.0, headers=headers
        ) as client:
            r = await client.head(url)
            final = str(r.url)
            if final and final != url:
                logger.info("redirect %s → %s", url[:60], final[:80])
                return final
            # some CDNs block HEAD — try GET stream
            r = await client.get(url)
            final = str(r.url)
            if final:
                return final
    except Exception as e:
        logger.warning("resolve_redirects failed: %s", e)
    return url


def _generic_opts(outdir: str | None = None) -> dict[str, Any]:
    """Clean opts for TikTok / Instagram / Twitter / etc — NO youtube player_client."""
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "restrictfilenames": True,
        "noplaylist": True,
        "socket_timeout": 30,
        "retries": 5,
        "extractor_retries": 3,
        "fragment_retries": 5,
        "ignoreerrors": False,
        "geo_bypass": True,
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 "
                "Mobile/15E148 Safari/604.1"
            ),
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.tiktok.com/",
        },
    }
    if outdir:
        opts["outtmpl"] = os.path.join(outdir, "%(id)s.%(ext)s")
    return opts


def _youtube_opts(outdir: str | None = None, clients: list[str] | None = None) -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "restrictfilenames": True,
        "noplaylist": True,
        "socket_timeout": 30,
        "retries": 4,
        "extractor_retries": 2,
        "fragment_retries": 4,
        "ignoreerrors": False,
        "geo_bypass": True,
        "http_headers": {
            "User-Agent": (
                "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
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


def _to_media_info(info: dict, fallback_url: str) -> MediaInfo:
    return MediaInfo(
        title=info.get("title") or "بدون عنوان",
        duration=info.get("duration"),
        thumbnail=info.get("thumbnail"),
        webpage_url=info.get("webpage_url") or fallback_url,
        extractor=info.get("extractor") or info.get("extractor_key") or "unknown",
    )


async def extract_info(url: str) -> tuple[MediaInfo | None, str]:
    """Returns (info, error_message). error_message empty on success."""
    url = normalize_url(url)
    last_err = ""

    # Resolve short links first (critical for TikTok vt/vm)
    if is_tiktok(url) or re.search(r"(vm\.|vt\.|bit\.ly|t\.co)", url, re.I):
        url = normalize_url(await resolve_redirects(url))

    try:
        import yt_dlp
    except Exception as e:
        return None, f"yt-dlp غير مثبت: {e}"

    if is_youtube(url):
        for clients in _YT_CLIENT_GROUPS:
            try:

                def _run() -> dict | None:
                    opts = _youtube_opts(clients=clients)
                    opts["skip_download"] = True
                    with yt_dlp.YoutubeDL(opts) as ydl:
                        return ydl.extract_info(url, download=False)

                info = await asyncio.wait_for(asyncio.to_thread(_run), timeout=EXTRACT_TIMEOUT)
                if info:
                    return _to_media_info(info, url), ""
            except asyncio.TimeoutError:
                last_err = f"timeout youtube clients={clients}"
                logger.warning(last_err)
            except Exception as e:
                last_err = f"{type(e).__name__}: {e}"
                logger.warning("youtube extract %s: %s", clients, last_err)
        return None, last_err or "youtube extract failed"

    # ---- Generic / TikTok / Instagram / Twitter ----
    attempts = [url]
    # also try original short form if we resolved
    for attempt_url in attempts:
        try:

            def _run_g() -> dict | None:
                opts = _generic_opts()
                opts["skip_download"] = True
                with yt_dlp.YoutubeDL(opts) as ydl:
                    return ydl.extract_info(attempt_url, download=False)

            info = await asyncio.wait_for(asyncio.to_thread(_run_g), timeout=EXTRACT_TIMEOUT)
            if info:
                return _to_media_info(info, attempt_url), ""
        except asyncio.TimeoutError:
            last_err = "timeout generic extract"
            logger.warning(last_err)
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            logger.warning("generic extract: %s", last_err)

    return None, last_err or "extract failed"


async def download_media(
    url: str,
    quality: str = "720",
    media_type: str = "video",
) -> tuple[DownloadResult | None, str]:
    """Returns (result, error_message)."""
    url = normalize_url(url)
    last_err = ""

    if is_tiktok(url) or re.search(r"(vm\.|vt\.)", url, re.I):
        url = normalize_url(await resolve_redirects(url))

    tmp = tempfile.mkdtemp(prefix="mediabot_")

    try:
        import yt_dlp
    except Exception as e:
        return None, f"yt-dlp missing: {e}"

    def _apply_format(opts: dict[str, Any]) -> None:
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
            # progressive first — avoids needing ffmpeg merge on free tier
            fmt = {
                "360": "best[height<=360]/bestvideo[height<=360]+bestaudio/best",
                "480": "best[height<=480]/bestvideo[height<=480]+bestaudio/best",
                "720": "best[height<=720]/bestvideo[height<=720]+bestaudio/best",
            }.get(quality, "best[height<=720]/best")
            opts["format"] = fmt
            opts["merge_output_format"] = "mp4"

    client_groups = _YT_CLIENT_GROUPS if is_youtube(url) else [None]

    for clients in client_groups:
        try:
            if is_youtube(url):
                opts = _youtube_opts(tmp, clients=clients)
            else:
                opts = _generic_opts(tmp)
            _apply_format(opts)

            def _run() -> dict | None:
                with yt_dlp.YoutubeDL(opts) as ydl:
                    return ydl.extract_info(url, download=True)

            info = await asyncio.wait_for(asyncio.to_thread(_run), timeout=DOWNLOAD_TIMEOUT)
            if not info:
                continue

            filepath = None
            if info.get("requested_downloads"):
                filepath = info["requested_downloads"][0].get("filepath")
            if not filepath:
                files = sorted(
                    Path(tmp).glob("*"),
                    key=lambda p: p.stat().st_mtime,
                    reverse=True,
                )
                files = [f for f in files if f.is_file() and not f.name.endswith(".part")]
                if files:
                    filepath = str(files[0])

            if not filepath or not os.path.isfile(filepath):
                last_err = "no output file"
                continue

            path = Path(filepath)
            return (
                DownloadResult(
                    path=path,
                    title=info.get("title") or path.stem,
                    media_type=media_type,
                    filesize=path.stat().st_size,
                    thumbnail=info.get("thumbnail"),
                ),
                "",
            )
        except asyncio.TimeoutError:
            last_err = f"timeout clients={clients}"
            logger.warning(last_err)
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            logger.warning("download failed: %s", last_err)

    return None, last_err or "download failed"
