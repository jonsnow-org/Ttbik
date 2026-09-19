"""Downloader: TikWM (TikTok) → yt-dlp → Cobalt."""

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

_YT_CLIENT_GROUPS = [
    ["android_vr"],
    ["tv_downgraded"],
    ["android"],
    ["tv"],
    ["web_safari"],
    ["mweb"],
    ["web_embedded"],
]
_TIKTOK_API_HOSTS = [
    "api16-normal-c-useast1a.tiktokv.com",
    "api22-normal-c-useast2a.tiktokv.com",
]

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
_UA_MOBILE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
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
    # X.com → twitter.com (yt-dlp extractor id is still "twitter")
    u = re.sub(r"https?://(www\.)?x\.com/", "https://twitter.com/", u, flags=re.I)
    u = re.sub(r"https?://(mobile\.)?twitter\.com/", "https://twitter.com/", u, flags=re.I)
    m = re.search(r"twitter\.com/[^/]+/status/(\d+)", u, re.I)
    if m:
        return f"https://twitter.com/i/status/{m.group(1)}"
    return u


async def resolve_redirects(url: str) -> str:
    try:
        import httpx
        headers = {"User-Agent": _UA_MOBILE}
        async with httpx.AsyncClient(follow_redirects=True, timeout=15.0, headers=headers) as client:
            try:
                r = await client.head(url)
                if str(r.url) != url and "tiktok.com" in str(r.url):
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
    normalized = raw.replace("\\r\\n", "\n").replace("\\n", "\n").replace("\\t", "\t")
    if "# Netscape" in normalized or "youtube.com" in normalized or "\t" in normalized:
        path = "/tmp/ytdlp_cookies.txt"
        with open(path, "w", encoding="utf-8") as f:
            if not normalized.startswith("#"):
                f.write("# Netscape HTTP Cookie File\n")
            f.write(normalized if normalized.endswith("\n") else normalized + "\n")
        return path
    return None


def _proxy() -> str | None:
    p = (os.getenv("PROXY_URL") or os.getenv("HTTPS_PROXY") or "").strip()
    if not p:
        return None
    low = p.lower()
    if any(x in low for x in ("user:pass", "host:port", "username:password", "example.com", "127.0.0.1:0", "proxy.example")):
        return None
    if not re.match(r"^https?://", p, re.I) and not re.match(r"^socks5?://", p, re.I):
        return None
    return p


async def _tikwm_download(url: str, audio_only: bool = False) -> tuple[DownloadResult | None, str]:
    try:
        import httpx
    except Exception as e:
        return None, f"tikwm: httpx missing ({e})"
    try:
        url = await resolve_redirects(url)
    except Exception:
        pass
    endpoints = [
        f"https://www.tikwm.com/api/?url={quote(url, safe='')}&hd=1",
        f"https://tikwm.com/api/?url={quote(url, safe='')}&hd=1",
    ]
    meta = None
    last_status = ""
    headers_list = [
        {"User-Agent": _UA_MOBILE, "Accept": "application/json"},
        {"User-Agent": _UA, "Accept": "application/json", "Referer": "https://www.tikwm.com/"},
    ]
    for headers in headers_list:
        async with httpx.AsyncClient(timeout=40.0, follow_redirects=True, headers=headers) as client:
            for ep in endpoints:
                for attempt in range(2):
                    try:
                        if attempt:
                            await asyncio.sleep(1.2)
                        r = await client.get(ep)
                        last_status = f"HTTP {r.status_code}"
                        if r.status_code >= 400:
                            continue
                        js = r.json()
                        if js.get("code") != 0:
                            last_status = f"code={js.get('code')} msg={js.get('msg')}"
                            continue
                        d = js.get("data") or {}
                        play = d.get("hdplay") or d.get("play") or d.get("wmplay")
                        music = d.get("music")
                        media = music if audio_only and music else play
                        if not media:
                            last_status = "no media url"
                            continue
                        meta = {"media": media, "title": (d.get("title") or "TikTok")[:120], "thumbnail": d.get("cover") or d.get("origin_cover")}
                        break
                    except Exception as e:
                        last_status = str(e)
                if meta:
                    break
        if meta:
            break
    if not meta:
        return None, f"tikwm: resolve failed ({last_status})"
    suffix = ".mp3" if audio_only else ".mp4"
    tmp = tempfile.mkdtemp(prefix="tikwm_")
    path = Path(tmp) / f"media{suffix}"
    try:
        async with httpx.AsyncClient(timeout=180.0, follow_redirects=True) as client:
            async with client.stream("GET", meta["media"], headers={"User-Agent": _UA_MOBILE, "Referer": "https://www.tiktok.com/"}) as r:
                if r.status_code >= 400:
                    return None, f"tikwm: download HTTP {r.status_code}"
                with open(path, "wb") as f:
                    async for chunk in r.aiter_bytes(64 * 1024):
                        f.write(chunk)
        size = path.stat().st_size
        if size < 1000:
            return None, f"tikwm: file too small ({size})"
        return DownloadResult(path=path, title=meta["title"], media_type="audio" if audio_only else "video", filesize=size, thumbnail=meta.get("thumbnail")), ""
    except Exception as e:
        return None, f"tikwm: {e}"


async def extract_info(url: str) -> tuple[MediaInfo | None, str]:
    url = normalize_url(url)
    last_err = ""
    if is_tiktok(url) or re.search(r"(vm\.|vt\.)", url, re.I):
        url = normalize_url(await resolve_redirects(url))
        try:
            import httpx
            async with httpx.AsyncClient(timeout=25.0, headers={"User-Agent": _UA_MOBILE}) as client:
                r = await client.get(f"https://www.tikwm.com/api/?url={quote(url, safe='')}&hd=1")
                if r.status_code < 400:
                    js = r.json()
                    if js.get("code") == 0 and js.get("data"):
                        d = js["data"]
                        return MediaInfo(title=(d.get("title") or "TikTok")[:120], duration=int(d.get("duration") or 0) or None, thumbnail=d.get("cover") or d.get("origin_cover"), webpage_url=url, extractor="tikwm"), ""
        except Exception as e:
            last_err = str(e)
        return MediaInfo("فيديو تيك توك", None, None, url, "tikwm"), ""
    try:
        import yt_dlp
    except Exception as e:
        return None, f"yt-dlp missing: {e}"
    if is_youtube(url):
        for clients in [*_YT_CLIENT_GROUPS, None]:
            try:
                def _run() -> dict | None:
                    opts: dict[str, Any] = {"quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True, "socket_timeout": 25, "force_ipv4": True}
                    if clients:
                        opts["extractor_args"] = {"youtube": {"player_client": clients}}
                    ck = _write_cookies_file()
                    if ck:
                        opts["cookiefile"] = ck
                    px = _proxy()
                    if px:
                        opts["proxy"] = px
                    with yt_dlp.YoutubeDL(opts) as ydl:
                        return ydl.extract_info(url, download=False)
                info = await asyncio.wait_for(asyncio.to_thread(_run), timeout=EXTRACT_TIMEOUT)
                if info:
                    return MediaInfo(title=info.get("title") or "YouTube", duration=int(info["duration"]) if info.get("duration") is not None else None, thumbnail=info.get("thumbnail"), webpage_url=info.get("webpage_url") or url, extractor="youtube"), ""
            except Exception as e:
                last_err = f"{type(e).__name__}: {e}"
                continue
        return MediaInfo("فيديو يوتيوب", None, None, url, "youtube"), ""
    try:
        def _run_g() -> dict | None:
            opts: dict[str, Any] = {"quiet": True, "no_warnings": True, "skip_download": True, "noplaylist": True, "socket_timeout": 25}
            ck = _write_cookies_file()
            if ck:
                opts["cookiefile"] = ck
            px = _proxy()
            if px:
                opts["proxy"] = px
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(url, download=False)
        info = await asyncio.wait_for(asyncio.to_thread(_run_g), timeout=EXTRACT_TIMEOUT)
        if info:
            return MediaInfo(title=info.get("title") or "media", duration=int(info["duration"]) if info.get("duration") is not None else None, thumbnail=info.get("thumbnail"), webpage_url=info.get("webpage_url") or url, extractor=info.get("extractor") or "generic"), ""
    except Exception as e:
        last_err = f"{type(e).__name__}: {e}"
    return None, last_err or "extract failed"


async def download_media(url: str, quality: str = "720", media_type: str = "video") -> tuple[DownloadResult | None, str]:
    url = normalize_url(url)
    audio_only = media_type in ("audio", "voice")
    errors: list[str] = []
    if is_tiktok(url) or re.search(r"(vm\.|vt\.)", url, re.I):
        result, err = await _tikwm_download(url, audio_only=audio_only)
        if result:
            return result, ""
        errors.append(err or "tikwm failed")
    tmp = tempfile.mkdtemp(prefix="mediabot_")
    try:
        import yt_dlp
    except Exception as e:
        errors.append(f"yt-dlp missing: {e}")
        yt_dlp = None  # type: ignore
    if yt_dlp is not None:
        def _opts(outdir: str) -> dict[str, Any]:
            o: dict[str, Any] = {"quiet": True, "no_warnings": True, "noprogress": True, "restrictfilenames": True, "noplaylist": True, "socket_timeout": 30, "retries": 2, "force_ipv4": True, "outtmpl": os.path.join(outdir, "%(id)s.%(ext)s")}
            ck = _write_cookies_file()
            if ck:
                o["cookiefile"] = ck
            px = _proxy()
            if px:
                o["proxy"] = px
            if audio_only:
                o["format"] = "bestaudio/best"
                o["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3" if media_type == "audio" else "opus", "preferredquality": "192"}]
            else:
                fmt = {"360": "best[height<=360]/best", "480": "best[height<=480]/best", "720": "best[height<=720]/best"}.get(quality, "best[height<=720]/best")
                o["format"] = fmt
                o["merge_output_format"] = "mp4"
                # merge_output_format only applies when yt-dlp actually merges
                # separate video+audio streams. Sources like Twitter/X are
                # commonly served as HLS and yt-dlp downloads/concats those
                # segments without going through that merge step, so the
                # result can be a container with its moov atom at the end
                # (or otherwise not "faststart") -- browsers then refuse to
                # start playback until the whole file is fetched, unlike a
                # direct progressive mp4 (e.g. TikTok, Facebook), which
                # already streams fine. Force a fast remux (no re-encode) to
                # mp4 so this is fixed unconditionally, whatever the source.
                o.setdefault("postprocessors", []).append(
                    {"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}
                )
            return o
        attempts: list[dict[str, Any]] = []
        if is_youtube(url):
            for clients in _YT_CLIENT_GROUPS:
                o = _opts(tmp)
                o["extractor_args"] = {"youtube": {"player_client": clients}}
                attempts.append(o)
            attempts.append(_opts(tmp))
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
                def _run_dl(o=opts) -> str | None:
                    with yt_dlp.YoutubeDL(o) as ydl:
                        info = ydl.extract_info(url, download=True)
                        if not info:
                            return None
                        if "requested_downloads" in info and info["requested_downloads"]:
                            return info["requested_downloads"][0].get("filepath")
                        return ydl.prepare_filename(info)
                path_s = await asyncio.wait_for(asyncio.to_thread(_run_dl), timeout=DOWNLOAD_TIMEOUT)
                if path_s and Path(path_s).exists():
                    p = Path(path_s)
                    # postprocessor may change extension
                    if audio_only and not p.exists():
                        for alt in p.parent.glob(p.stem + ".*"):
                            p = alt
                            break
                    if p.exists() and p.stat().st_size > 1000:
                        return DownloadResult(path=p, title=p.stem[:120], media_type=media_type if media_type in ("audio", "voice") else "video", filesize=p.stat().st_size), ""
            except Exception as e:
                errors.append(f"yt-dlp: {type(e).__name__}: {e}")
                continue
    # Cobalt fallback
    try:
        import httpx
        cobalt = (os.getenv("COBALT_API_URL") or "https://api.cobalt.tools/").rstrip("/") + "/"
        headers = {"Accept": "application/json", "Content-Type": "application/json", "User-Agent": _UA}
        key = (os.getenv("COBALT_API_KEY") or "").strip()
        if key:
            headers["Authorization"] = f"Api-Key {key}"
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            r = await client.post(cobalt, headers=headers, json={"url": url, "downloadMode": "audio" if audio_only else "auto", "videoQuality": quality if quality in ("360", "480", "720") else "720"})
            if r.status_code < 400:
                js = r.json()
                media_url = js.get("url") or (js.get("tunnel") if isinstance(js.get("tunnel"), str) else None)
                if media_url:
                    path = Path(tmp) / ("media.mp3" if audio_only else "media.mp4")
                    async with client.stream("GET", media_url) as rr:
                        with open(path, "wb") as f:
                            async for chunk in rr.aiter_bytes(64 * 1024):
                                f.write(chunk)
                    if path.stat().st_size > 1000:
                        return DownloadResult(path=path, title="media", media_type="audio" if audio_only else "video", filesize=path.stat().st_size), ""
            else:
                errors.append(f"cobalt HTTP {r.status_code}")
    except Exception as e:
        errors.append(f"cobalt: {e}")
    joined = " | ".join(errors[-4:]) if errors else "download failed"
    return None, joined
