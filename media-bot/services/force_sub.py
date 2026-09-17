"""
Forced subscription check.
If FORCE_SUB_CHANNEL is set, user must be a member before using the bot.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from telegram import Bot
    from telegram.ext import ContextTypes

logger = logging.getLogger(__name__)


async def is_subscribed(bot: "Bot", user_id: int, channel: str | None) -> bool:
    """Return True if no channel is required or user is already a member."""
    if not channel:
        return True

    try:
        member = await bot.get_chat_member(chat_id=channel, user_id=user_id)
        status = member.status
        return status in ("member", "administrator", "creator")
    except Exception as e:
        logger.warning("force_sub check failed for %s: %s", user_id, e)
        # Fail open to avoid locking everyone out if channel is misconfigured
        return True


async def require_subscription(
    bot: "Bot",
    user_id: int,
    channel: str | None,
    chat_id: int,
) -> bool:
    """
    If user is not subscribed, send a join message and return False.
    Otherwise return True (allowed to proceed).
    """
    if await is_subscribed(bot, user_id, channel):
        return True

    # Build a friendly join link
    if channel.startswith("@"):
        link = f"https://t.me/{channel[1:]}"
    else:
        link = f"https://t.me/c/{str(channel).replace('-100', '')}"

    from telegram import InlineKeyboardButton, InlineKeyboardMarkup

    kb = InlineKeyboardMarkup(
        [[InlineKeyboardButton("🔔 اشترك الآن", url=link)],
         [InlineKeyboardButton("✅ تحققت من الاشتراك", callback_data="check_sub")]]
    )

    await bot.send_message(
        chat_id=chat_id,
        text=(
            "⚠️ يجب الاشتراك في القناة أولاً لاستخدام البوت.\n\n"
            "بعد الاشتراك اضغط «تحققت من الاشتراك»."
        ),
        reply_markup=kb,
    )
    return False
