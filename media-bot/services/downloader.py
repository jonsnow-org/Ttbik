"""Downloader: TikWM (primary for TikTok) → yt-dlp → Cobalt."""

from __future__ import annotations

import asyncio
import logging
import os
import re
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import quote

logger = logging.getLogger(__name__)

EXTRACT_TIMEOUT = 45
DOWNLOAD_TIMEOUT = 180

_YT_CLIENT_GROUPS = [["android"], ["tv"], ["web_safari"], ["mweb"]]
_TIKTOK_API_HOSTS = [
    "api16-normal-c-useast1a.tiktokv.com",
    "api22-normal-c-useast2a.tiktokv.com",
]

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


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

        headers = {"User-Agent": _UA}
        async with httpx.AsyncClient(follow_redirects=True, timeout=12.0, headers=headers) as client:
            try:
                r = await client.head(url)
                if str(r.url) != url:
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
            f.write(raw if raw.endswith("\n") else raw + "\n")
        return path
    return None


# ---------------------------------------------------------------------------
# TikWM — primary for TikTok (works from datacenter IPs)
# ---------------------------------------------------------------------------
async def _tikwm_download(url: str, audio_only: bool = False) -> tuple[DownloadResult | None, str]:
    """Inline TikWM — no fragile imports."""
    try:
        import httpx
    except Exception as e:
        return None, f"tikwm: httpx missing ({e})"

    endpoints = [
        f"https://www.tikwm.com/api/?url={quote(url, safe='')}&hd=1",
        f"https://tikwm.com/api/?url={quote(url, safe='')}&hd=1",
    ]
    meta = None
    async with httpx.AsyncClient(timeout=40.0, follow_redirects=True, headers={"User-Agent": _UA}) as client:
        for ep in endpoints:
            try:
                r = await client.get(ep)
                logger.info("tikwm status=%s url=%s", r.status_code, ep[:60])
                if r.status_code >= 400:
                    continue
                js = r.json()
                if js.get("code") != 0:
                    logger.warning("tikwm code=%s msg=%s", js.get("code"), js.get("msg"))
                    continue
                d = js.get("data") or {}
                play = d.get("hdplay") or d.get("play") or d.get("wmplay")
                music = d.get("music")
                media = music if audio_only and music else play
                if not media:
                    continue
                meta = {
                    "media": media,
                    "title": (d.get("title") or "TikTok")[:120],
                    "thumbnail": d.get("cover") or d.get("origin_cover"),
                }
                break
            except Exception as e:
                logger.warning("tikwm request: %s", e)

    if not meta:
        return None, "tikwm: resolve failed (no media url)"

    suffix = ".mp3" if audio_only else ".mp4"
    tmp = tempfile.mkdtemp(prefix="tikwm_")
    path = Path(tmp) / f"media{suffix}"
    try:
        async with httpx.AsyncClient(timeout=180.0, follow_redirects=True) as client:
            async with client.stream(
                "GET",
                meta["media"],
                headers={"User-Agent": _UA, "Referer": "https://www.tiktok.com/"},
            ) as r:
                if r.status_code >= 400:
                    return None, f"tikwm: download HTTP {r.status_code}"
                with open(path, "wb") as f:
                    async for chunk in r.aiter_bytes(64 * 1024):
                        f.write(chunk)
        size = path.stat().st_size
        if size < 1000:
            return None, f"tikwm: file too small ({size})"
        logger.info("tikwm OK size=%s", size)
        return (
            DownloadResult(
                path=path,
                title=meta["title"],
                media_type="audio" if audio_only else "video",
                filesize=size,
                thumbnail=meta.get("thumbnail"),
            ),
            "",
        )
    except Exception as e:
        return None, f"tikwm: download error {e}"


async def extract_info(url: str) -> tuple[MediaInfo | None, str]:
    url = normalize_url(url)
    last_err = ""

    if is_tiktok(url) or re.search(r"(vm\.|vt\.)", url, re.I):
        url = normalize_url(await resolve_redirects(url))
        # quick metadata via tikwm
        try:
            import httpx

            async with httpx.AsyncClient(timeout=25.0, headers={"User-Agent": _UA}) as client:
                r = await client.get(
                    f"https://www.tikwm.com/api/?url={quote(url, safe='')}&hd=1"
                )
                if r.status_code < 400:
                    js = r.json()
                    if js.get("code") == 0 and js.get("data"):
                        d = js["data"]
                        return (
                            MediaInfo(
                                title=(d.get("title") or "TikTok")[:120],
                                duration=int(d.get("duration") or 0) or None,
                                thumbnail=d.get("cover") or d.get("origin_cover"),
                                webpage_url=url,
                                extractor="tikwm",
                            ),
                            "",
                        )
        except Exception as e:
            last_err = f"tikwm-meta: {e}"
            logger.warning(last_err)

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
                    opts = {
                        "quiet": True,
                        "no_warnings": True,
                        "skip_download": True,
                        "noplaylist": True,
                        "socket_timeout": 25,
                        "extractor_args": {"youtube": {"player_client": clients}},
                    }
                    ck = _write_cookies_file()
                    if ck:
                        opts["cookiefile"] = ck
                    with yt_dlp.YoutubeDL(opts) as ydl:
                        return ydl.extract_info(url, download=False)

                info = await asyncio.wait_for(asyncio.to_thread(_run), timeout=EXTRACT_TIMEOUT)
                if info:
                    return (
                        MediaInfo(
                            title=info.get("title") or "YouTube",
                            duration=info.get("duration"),
                            thumbnail=info.get("thumbnail"),
                            webpage_url=info.get("webpage_url") or url,
                            extractor="youtube",
                        ),
                        "",
                    )
            except Exception as e:
                last_err = f"{type(e).__name__}: {e}"
                if "Sign in" in last_err or "not a bot" in last_err:
                    break
        return MediaInfo("فيديو يوتيوب", None, None, url, "youtube"), ""

    # generic yt-dlp
    try:

        def _run_g() -> dict | None:
            opts = {
                "quiet": True,
                "no_warnings": True,
                "skip_download": True,
                "noplaylist": True,
                "socket_timeout": 25,
            }
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(url, download=False)

        info = await asyncio.wait_for(asyncio.to_thread(_run_g), timeout=EXTRACT_TIMEOUT)
        if info:
            return (
                MediaInfo(
                    title=info.get("title") or "media",
                    duration=info.get("duration"),
                    thumbnail=info.get("thumbnail"),
                    webpage_url=info.get("webpage_url") or url,
                    extractor=info.get("extractor") or "generic",
                ),
                "",
            )
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
    audio_only = media_type in ("audio", "voice")
    errors: list[str] = []

    # ---- 1) TikTok → TikWM first ----
    if is_tiktok(url) or re.search(r"(vm\.|vt\.)", url, re.I):
        try:
            url = normalize_url(await resolve_redirects(url))
        except Exception:
            pass
        result, err = await _tikwm_download(url, audio_only=audio_only)
        if result:
            return result, ""
        errors.append(err or "tikwm failed")
        logger.warning("TikWM failed: %s", err)

    # ---- 2) yt-dlp ----
    tmp = tempfile.mkdtemp(prefix="mediabot_")
    try:
        import yt_dlp
    except Exception as e:
        errors.append(f"yt-dlp missing: {e}")
        yt_dlp = None  # type: ignore

    if yt_dlp is not None:
        def _opts(outdir: str) -> dict[str, Any]:
            o: dict[str, Any] = {
                "quiet": True,
                "no_warnings": True,
                "noprogress": True,
                "restrictfilenames": True,
                "noplaylist": True,
                "socket_timeout": 30,
                "retries": 2,
                "outtmpl": os.path.join(outdir, "%(id)s.%(ext)s"),
            }
            ck = _write_cookies_file()
            if ck:
                o["cookiefile"] = ck
            if audio_only:
                o["format"] = "bestaudio/best"
                o["postprocessors"] = [
                    {
                        "key": "FFmpegExtractAudio",
                        "preferredcodec": "mp3" if media_type == "audio" else "opus",
                        "preferredquality": "192",
                    }
                ]
            else:
                fmt = {
                    "360": "best[height<=360]/best",
                    "480": "best[height<=480]/best",
                    "720": "best[height<=720]/best",
                }.get(quality, "best[height<=720]/best")
                o["format"] = fmt
                o["merge_output_format"] = "mp4"
            return o

        attempts: list[dict[str, Any]] = []
        if is_youtube(url):
            for clients in _YT_CLIENT_GROUPS:
                o = _opts(tmp)
                o["extractor_args"] = {"youtube": {"player_client": clients}}
                attempts.append(o)
        elif is_tiktok(url):
            for host in _TIKTOK_API_HOSTS:
                o = _opts(tmp)
                o["extractor_args"] = {"tiktok": {"api_hostname": [host]}}
                o["http_headers"] = {"User-Agent": _UA, "Referer": "https://www.tiktok.com/"}
                attempts.append(o)
        else:
            attempts.append(_opts(tmp))

        for opts in attempts:
            try:

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
                    files = [
                        f
                        for f in sorted(Path(tmp).glob("*"), key=lambda p: p.stat().st_mtime, reverse=True)
                        if f.is_file() and not f.name.endswith(".part")
                    ]
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
                errors.append("yt-dlp: timeout")
            except Exception as e:
                msg = f"{type(e).__name__}: {e}"
                errors.append(f"yt-dlp: {msg[:120]}")
                logger.warning("yt-dlp: %s", msg)
                if "Sign in" in msg or "not a bot" in msg or "status code 0" in msg:
                    break

    # ---- 3) Cobalt last ----
    try:
        from services.cobalt import cobalt_download_to_file

        path, title, err = await cobalt_download_to_file(
            url, quality=quality, audio_only=audio_only
        )
        if path:
            return (
                DownloadResult(
                    path=path,
                    title=title or "media",
                    media_type=media_type,
                    filesize=path.stat().st_size,
                ),
                "",
            )
        errors.append(f"cobalt: {err}")
    except Exception as e:
        errors.append(f"cobalt: {e}")

    # Helpful hint for YouTube bot-check
    joined = " | ".join(errors) if errors else "all providers failed"
    if is_youtube(url) and any("bot" in e.lower() or "Sign in" in e for e in errors):
        joined += " | ضع YTDLP_COOKIES في Render"
    return None, joined
