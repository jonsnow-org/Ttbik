"""
Telegram Channel as permanent archive (Zero-DB Native).

When a media is downloaded for the first time:
  1. Send it silently to ARCHIVE_CHANNEL_ID
  2. Store file_id + original URL in the message caption / text

Later requests for the same URL can re-send via file_id without re-downloading.

In-memory cache is used for speed; on cold start we can rebuild gradually.
"""

from __future__ import annotations

import hashlib
import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from telegram import Bot
    from telegram.ext import ContextTypes

logger = logging.getLogger(__name__)

# Simple in-memory cache: key -> file_id
# key = sha256(url + media_type + quality)
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
) -> str | None:
    """
    Send the file to the archive channel (if configured) and return file_id.
    Also updates the in-memory cache.
    """
    if not archive_channel_id:
        logger.warning("No ARCHIVE_CHANNEL_ID — skipping permanent archive")
        return None

    caption = f"🔗 {url}\n📁 {media_type}:{quality}\n📌 {title[:200]}"

    try:
        if media_type == "voice":
            msg = await bot.send_voice(
                chat_id=archive_channel_id,
                voice=open(file_path, "rb"),
                caption=caption,
                disable_notification=True,
            )
            file_id = msg.voice.file_id if msg.voice else None
        elif media_type == "audio":
            msg = await bot.send_audio(
                chat_id=archive_channel_id,
                audio=open(file_path, "rb"),
                caption=caption,
                title=title[:64],
                disable_notification=True,
            )
            file_id = msg.audio.file_id if msg.audio else None
        else:
            msg = await bot.send_video(
                chat_id=archive_channel_id,
                video=open(file_path, "rb"),
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
) -> bool:
    """Send media to user using file_id if available, else local path."""
    try:
        if file_id:
            if media_type == "voice":
                await bot.send_voice(chat_id=chat_id, voice=file_id)
            elif media_type == "audio":
                await bot.send_audio(chat_id=chat_id, audio=file_id, title=title[:64])
            else:
                await bot.send_video(chat_id=chat_id, video=file_id, supports_streaming=True)
            return True

        if file_path:
            if media_type == "voice":
                await bot.send_voice(chat_id=chat_id, voice=open(file_path, "rb"))
            elif media_type == "audio":
                await bot.send_audio(chat_id=chat_id, audio=open(file_path, "rb"), title=title[:64])
            else:
                await bot.send_video(chat_id=chat_id, video=open(file_path, "rb"), supports_streaming=True)
            return True
    except Exception as e:
        logger.exception("send_from_cache_or_file failed: %s", e)

    return False
