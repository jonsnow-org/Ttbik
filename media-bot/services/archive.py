"""Telegram Channel archive + send helpers."""

from __future__ import annotations

import hashlib
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from telegram import Bot

logger = logging.getLogger(__name__)

_cache: dict[str, str] = {}


def make_key(url: str, media_type: str, quality: str) -> str:
    raw = f"{url.strip()}|{media_type}|{quality}"
    return hashlib.sha256(raw.encode()).hexdigest()


def get_cached_file_id(url: str, media_type: str, quality: str) -> str | None:
    return _cache.get(make_key(url, media_type, quality))


def set_cached_file_id(url: str, media_type: str, quality: str, file_id: str) -> None:
    _cache[make_key(url, media_type, quality)] = file_id


async def archive_and_get_file_id(
    bot: "Bot",
    archive_channel_id: str | None,
    file_path: str,
    url: str,
    media_type: str,
    quality: str,
    title: str,
    downloader_name: str | None = None,
    downloader_id: int | None = None,
) -> str | None:
    if not archive_channel_id:
        logger.warning("No ARCHIVE_CHANNEL_ID — skipping permanent archive")
        return None

    who = downloader_name or "مستخدم"
    uid = f" ({downloader_id})" if downloader_id else ""
    caption = (
        f"🔗 {url}\n"
        f"📁 {media_type}:{quality}\n"
        f"📌 {title[:180]}\n"
        f"👤 بواسطة: {who}{uid}"
    )

    try:
        if media_type == "voice":
            with open(file_path, "rb") as f:
                msg = await bot.send_voice(
                    chat_id=archive_channel_id,
                    voice=f,
                    caption=caption,
                    disable_notification=True,
                )
            file_id = msg.voice.file_id if msg.voice else None
        elif media_type == "audio":
            with open(file_path, "rb") as f:
                msg = await bot.send_audio(
                    chat_id=archive_channel_id,
                    audio=f,
                    caption=caption,
                    title=title[:64],
                    disable_notification=True,
                )
            file_id = msg.audio.file_id if msg.audio else None
        else:
            with open(file_path, "rb") as f:
                msg = await bot.send_video(
                    chat_id=archive_channel_id,
                    video=f,
                    caption=caption,
                    supports_streaming=True,
                    disable_notification=True,
                )
            file_id = msg.video.file_id if msg.video else None

        if file_id:
            set_cached_file_id(url, media_type, quality, file_id)
            logger.info("Archived %s → file_id cached", url[:60])
            return file_id
    except Exception as e:
        logger.exception("Failed to archive to channel: %s", e)

    return None


async def send_from_cache_or_file(
    bot: "Bot",
    chat_id: int,
    file_id: str | None,
    file_path: str | None,
    media_type: str,
    title: str,
) -> tuple[bool, str | None]:
    """Send media; return (ok, file_id)."""
    try:
        if file_id:
            if media_type == "voice":
                msg = await bot.send_voice(chat_id=chat_id, voice=file_id)
                return True, msg.voice.file_id if msg.voice else file_id
            if media_type == "audio":
                msg = await bot.send_audio(chat_id=chat_id, audio=file_id, title=title[:64])
                return True, msg.audio.file_id if msg.audio else file_id
            msg = await bot.send_video(chat_id=chat_id, video=file_id, supports_streaming=True)
            return True, msg.video.file_id if msg.video else file_id

        if file_path:
            if media_type == "voice":
                with open(file_path, "rb") as f:
                    msg = await bot.send_voice(chat_id=chat_id, voice=f)
                fid = msg.voice.file_id if msg.voice else None
                return True, fid
            if media_type == "audio":
                with open(file_path, "rb") as f:
                    msg = await bot.send_audio(chat_id=chat_id, audio=f, title=title[:64])
                fid = msg.audio.file_id if msg.audio else None
                return True, fid
            with open(file_path, "rb") as f:
                msg = await bot.send_video(chat_id=chat_id, video=f, supports_streaming=True)
            fid = msg.video.file_id if msg.video else None
            return True, fid
    except Exception as e:
        logger.exception("send_from_cache_or_file failed: %s", e)

    return False, None
