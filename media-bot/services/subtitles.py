"""Pull YouTube subtitles and build a short Arabic-friendly summary."""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

logger = logging.getLogger(__name__)


def _clean_vtt_or_srv(text: str) -> str:
    lines: list[str] = []
    for line in (text or "").splitlines():
        line = line.strip()
        if not line or line.startswith("WEBVTT") or "-->" in line or line.isdigit():
            continue
        line = re.sub(r"<[^>]+>", "", line)
        if line:
            lines.append(line)
    # de-dupe consecutive
    out: list[str] = []
    for ln in lines:
        if not out or out[-1] != ln:
            out.append(ln)
    return " ".join(out)


def _summarize_text(text: str, max_points: int = 3) -> list[str]:
    text = re.sub(r"\s+", " ", (text or "")).strip()
    if not text:
        return []
    # Split into sentences
    parts = re.split(r"(?<=[.!?؟۔])\s+", text)
    parts = [p.strip() for p in parts if len(p.strip()) > 25]
    if not parts:
        # fallback: chunk by length
        chunk = 120
        parts = [text[i : i + chunk].strip() for i in range(0, min(len(text), chunk * max_points), chunk)]
    # Prefer mid-video density: sample start / mid / end
    if len(parts) <= max_points:
        chosen = parts[:max_points]
    else:
        idxs = [0, len(parts) // 2, len(parts) - 1]
        chosen = [parts[i] for i in idxs[:max_points]]
    return [c[:180] + ("…" if len(c) > 180 else "") for c in chosen]


async def youtube_subtitle_summary(url: str) -> tuple[list[str], str | None]:
    """Return (bullet points, language_or_none). Best-effort, never raises."""
    try:
        import yt_dlp

        opts: dict[str, Any] = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitleslangs": ["ar", "en", "en-US", "en-GB"],
            "subtitlesformat": "vtt",
            "socket_timeout": 25,
            "extractor_args": {"youtube": {"player_client": ["tv", "web_safari", "android"]}},
        }

        def _run() -> dict | None:
            with yt_dlp.YoutubeDL(opts) as ydl:
                return ydl.extract_info(url, download=False)

        info = await asyncio.wait_for(asyncio.to_thread(_run), timeout=40)
        if not info:
            return [], None

        subs = info.get("subtitles") or {}
        autos = info.get("automatic_captions") or {}
        # Prefer Arabic manual, then Arabic auto, then English
        order = ["ar", "en", "en-US", "en-GB"]
        chosen_lang = None
        tracks = None
        for lang in order:
            if lang in subs and subs[lang]:
                tracks, chosen_lang = subs[lang], lang
                break
            if lang in autos and autos[lang]:
                tracks, chosen_lang = autos[lang], lang
                break
        if not tracks:
            # any available
            for src in (subs, autos):
                for lang, tr in src.items():
                    if tr:
                        tracks, chosen_lang = tr, lang
                        break
                if tracks:
                    break
        if not tracks:
            return [], None

        # Prefer vtt/srv3 url
        sub_url = None
        for t in tracks:
            if t.get("ext") in ("vtt", "srv3", "ttml", "json3") and t.get("url"):
                sub_url = t["url"]
                if t.get("ext") == "vtt":
                    break
        if not sub_url:
            return [], chosen_lang

        import httpx

        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.get(sub_url)
            if r.status_code >= 400:
                return [], chosen_lang
            body = r.text

        plain = _clean_vtt_or_srv(body)
        points = _summarize_text(plain, 3)
        return points, chosen_lang
    except Exception as e:
        logger.warning("subtitle summary failed: %s", e)
        return [], None


def guess_tags(title: str, extractor: str = "") -> list[str]:
    t = f"{title} {extractor}".lower()
    tags: list[str] = []
    rules = [
        ("تعليم|أغنية|song|music|remix|lyrics", "موسيقى"),
        ("learn|tutorial|كيف|شرح|course|درس|تعليم", "تعليم"),
        ("tech|برمجة|code|ai|ذكاء|تطبيق|software", "تقنية"),
        ("game|لعبة|gaming|ببجي|فري فاير", "ألعاب"),
        ("news|خبر|عاجل|سياسة", "أخبار"),
        ("comedy|مضحك|نكت|joke|funny", "ترفيه"),
        ("رياض|football|مباراة|sport", "رياضة"),
        ("طبخ|recipe|مطبخ|food", "طبخ"),
        ("podcast|بودكاست|محاضرة", "بودكاست"),
    ]
    for pat, tag in rules:
        if re.search(pat, t, re.I):
            tags.append(tag)
    if not tags:
        tags.append("عام")
    return tags[:3]
