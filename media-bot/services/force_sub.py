"""Forced subscription check for one or two channels."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from telegram import InlineKeyboardButton, InlineKeyboardMarkup

if TYPE_CHECKING:
    from telegram import Bot

logger = logging.getLogger(__name__)


def _join_url(channel: str) -> str:
    if channel.startswith("@"):
        return f"https://t.me/{channel[1:]}"
    cid = str(channel).replace("-100", "")
    return f"https://t.me/c/{cid}"


async def is_subscribed(bot: "Bot", user_id: int, channel: str) -> bool:
    try:
        member = await bot.get_chat_member(chat_id=channel, user_id=user_id)
        return member.status in ("member", "administrator", "creator")
    except Exception as e:
        logger.warning("force_sub check failed for %s on %s: %s", user_id, channel, e)
        return False


async def require_subscription(
    bot: "Bot",
    user_id: int,
    channels: list[str],
    chat_id: int,
) -> bool:
    if not channels:
        return True

    missing: list[str] = []
    for ch in channels:
        if not await is_subscribed(bot, user_id, ch):
            missing.append(ch)

    if not missing:
        return True

    rows = [[InlineKeyboardButton(f"🔔 اشترك: {ch}", url=_join_url(ch))] for ch in missing]
    rows.append([InlineKeyboardButton("✅ تحققت من الاشتراك", callback_data="check_sub")])

    text = "⚠️ يجب الاشتراك في القنوات التالية أولاً:\n\n" + "\n".join(missing)
    text += "\n\nبعد الاشتراك اضغط «تحققت من الاشتراك»."

    await bot.send_message(chat_id=chat_id, text=text, reply_markup=InlineKeyboardMarkup(rows))
    return False
