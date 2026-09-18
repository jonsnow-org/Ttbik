"""yt-dlp + TikWM + Cobalt fallbacks for cloud-IP blocks."""

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

EXTRACT_TIMEOUT = 50
DOWNLOAD_TIMEOUT = 180

_YT_CLIENT_GROUPS = [
    ["android"],
    ["tv"],
    ["web_safari"],
    ["mweb"],
]

_TIKTOK_API_HOSTS = [
    "api16-normal-c-useast1a.tiktokv.com",
    "api22-normal-c-useast2a.tiktokv.com",
    "api19-normal-c-useast1a.tiktokv.com",
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
    u = re.sub(r"([?&])(fbclid|si|feature|utm_[^=]+|pp)=[^&]*", r"\1", u, flags=re.I)
    u = u.replace("?&", "?").rstrip("?&")
    u = u.rstrip("/")

    m = re.search(r"(?:youtube\.com/shorts/|youtube\.com/embed/|youtu\.be/)([\w-]{6,})", u, re.I)
    if m:
        return f"https://www.youtube.com/watch?v={m.group(1)}"

    m = re.search(r"[?&]v=([\w-]{6,})", u, re.I)
    if m and "youtu" in u.lower():
        return f"https://www.youtube.com/watch?v={m.group(1)}"

    return u


async def resolve_redirects(url: str) -> str:
    try:
        import httpx

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) "
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
            )
        }
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0, headers=headers) as client:
            try:
                r = await client.head(url)
                if str(r.url) and str(r.url) != url:
                    return str(r.url)
            except Exception:
                pass
            r = await client.get(url)
            return str(r.url) or url
    except Exception as e:
        logger.warning("resolve_redirects: %s", e)
    return url


def _write_cookies_file() -> str | None:
    raw = (os.getenv("YTDLP_COOKIES") or "").strip()
    if not raw:
        return None
    if os.path.isfile(raw):
        return raw
    if "# Netscape" in raw or "youtube.com" in raw or "\t" in raw:
        path = "/tmp/ytdlp_cookies.txt"
        with open(path, "w", encoding="utf-8") as f:
            if not raw.startswith("#"):
                f.write("# Netscape HTTP Cookie File\n")
            f.write(raw)
            if not raw.endswith("\n"):
                f.write("\n")
        return path
    return None


def _generic_opts(outdir: str | None = None, tiktok_host: str | None = None) -> dict[str, Any]:
    opts: dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "restrictfilenames": True,
        "noplaylist": True,
        "socket_timeout": 30,
        "retries": 3,
        "extractor_retries": 2,
        "fragment_retries": 3,
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
    if tiktok_host:
        opts["extractor_args"] = {"tiktok": {"api_hostname": [tiktok_host]}}
    cookies = _write_cookies_file()
    if cookies:
        opts["cookiefile"] = cookies
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
        "retries": 3,
        "extractor_retries": 2,
        "fragment_retries": 3,
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
            "youtube": {"player_client": clients or ["android", "tv"]},
        },
    }
    cookies = _write_cookies_file()
    if cookies:
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
    url = normalize_url(url)
    last_err = ""

    if is_tiktok(url) or re.search(r"(vm\.|vt\.)", url, re.I):
        url = normalize_url(await resolve_redirects(url))
        # Prefer TikWM for metadata too
        try:
            from services.providers import tikwm_resolve

            meta = await tikwm_resolve(url)
            if meta:
                return (
                    MediaInfo(
                        title=meta.get("title") or "TikTok",
                        duration=meta.get("duration"),
                        thumbnail=meta.get("thumbnail"),
                        webpage_url=url,
                        extractor="tikwm",
                    ),
                    "",
                )
        except Exception as e:
            last_err = str(e)

    try:
        import yt_dlp
    except Exception as e:
        if is_tiktok(url):
            return MediaInfo("فيديو تيك توك", None, None, url, "tikwm"), ""
        return None, f"yt-dlp missing: {e}"

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
                last_err = f"timeout yt {clients}"
            except Exception as e:
                last_err = f"{type(e).__name__}: {e}"
                logger.warning("yt extract %s: %s", clients, last_err)
                if "Sign in to confirm" in last_err or "not a bot" in last_err:
                    break

        # Still show quality buttons — download may need cookies
        return MediaInfo("فيديو يوتيوب", None, None, url, "youtube"), ""

    hosts = _TIKTOK_API_HOSTS if is_tiktok(url) else [None]
    for host in hosts:
        try:

            def _run_g() -> dict | None:
                opts = _generic_opts(tiktok_host=host)
                opts["skip_download"] = True
                with yt_dlp.YoutubeDL(opts) as ydl:
                    return ydl.extract_info(url, download=False)

            info = await asyncio.wait_for(asyncio.to_thread(_run_g), timeout=EXTRACT_TIMEOUT)
            if info:
                return _to_media_info(info, url), ""
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"

    if is_tiktok(url):
        return MediaInfo("فيديو تيك توك", None, None, url, "tikwm"), ""

    return None, last_err or "extract failed"


async def download_media(
    url: str,
    quality: str = "720",
    media_type: str = "video",
) -> tuple[DownloadResult | None, str]:
    url = normalize_url(url)
    last_err = ""
    audio_only = media_type in ("audio", "voice")

    if is_tiktok(url) or re.search(r"(vm\.|vt\.)", url, re.I):
        url = normalize_url(await resolve_redirects(url))
        # ---- TikWM first (works on Render) ----
        try:
            from services.providers import provider_download_tiktok

            path, title, thumb, err = await provider_download_tiktok(url, audio_only=audio_only)
            if path:
                return (
                    DownloadResult(
                        path=path,
                        title=title or "TikTok",
                        media_type=media_type,
                        filesize=path.stat().st_size,
                        thumbnail=thumb,
                    ),
                    "",
                )
            last_err = err or "tikwm failed"
            logger.warning("tikwm: %s", last_err)
        except Exception as e:
            last_err = str(e)
            logger.warning("tikwm exception: %s", e)

    tmp = tempfile.mkdtemp(prefix="mediabot_")

    try:
        import yt_dlp
    except Exception as e:
        if is_tiktok(url):
            return None, last_err or str(e)
        return await _download_via_cobalt(url, quality, media_type, str(e))

    def _apply_format(opts: dict[str, Any]) -> None:
        if audio_only:
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
            fmt = {
                "360": "best[height<=360]/bestvideo[height<=360]+bestaudio/best",
                "480": "best[height<=480]/bestvideo[height<=480]+bestaudio/best",
                "720": "best[height<=720]/bestvideo[height<=720]+bestaudio/best",
            }.get(quality, "best[height<=720]/best")
            opts["format"] = fmt
            opts["merge_output_format"] = "mp4"

    if is_youtube(url):
        groups: list = _YT_CLIENT_GROUPS
    elif is_tiktok(url):
        groups = [(h,) for h in _TIKTOK_API_HOSTS]
    else:
        groups = [(None,)]

    for group in groups:
        try:
            if is_youtube(url):
                opts = _youtube_opts(tmp, clients=list(group))
            else:
                host = group[0] if group and group[0] else None
                opts = _generic_opts(tmp, tiktok_host=host)
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
                files = sorted(Path(tmp).glob("*"), key=lambda p: p.stat().st_mtime, reverse=True)
                files = [f for f in files if f.is_file() and not f.name.endswith(".part")]
                if files:
                    filepath = str(files[0])

            if filepath and os.path.isfile(filepath):
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
            last_err = "timeout"
        except Exception as e:
            last_err = f"{type(e).__name__}: {e}"
            logger.warning("yt-dlp download: %s", last_err)
            if "Sign in to confirm" in last_err or "not a bot" in last_err:
                break
            if "status code 0" in last_err:
                break

    # Cobalt last resort (needs JWT on many instances — may fail)
    logger.info("falling back to Cobalt for %s", url[:60])
    return await _download_via_cobalt(url, quality, media_type, last_err)


async def _download_via_cobalt(
    url: str, quality: str, media_type: str, prev_err: str
) -> tuple[DownloadResult | None, str]:
    from services.cobalt import cobalt_download_to_file

    audio_only = media_type in ("audio", "voice")
    path, title, err = await cobalt_download_to_file(
        url, quality=quality, audio_only=audio_only
    )
    if not path:
        hint = ""
        if is_youtube(url) and ("bot" in (prev_err or "").lower() or "Sign in" in (prev_err or "")):
            hint = (
                " | يوتيوب محجوب من سيرفر Render. "
                "ضع محتوى cookies.txt في متغير YTDLP_COOKIES"
            )
        return None, f"yt-dlp: {(prev_err or '')[:100]} | cobalt: {err}{hint}"

    return (
        DownloadResult(
            path=path,
            title=title or "media",
            media_type=media_type,
            filesize=path.stat().st_size,
            thumbnail=None,
        ),
        "",
    )
