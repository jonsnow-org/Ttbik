"""
In-memory store + optional persistence via archive channel message.
Holds: force-sub channels (up to 2), mini-app toggle, user privacy, stats.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field, asdict
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from telegram import Bot

logger = logging.getLogger(__name__)

SETTINGS_MARKER = "#MB_SETTINGS"


@dataclass
class Store:
    force_sub_channels: list[str] = field(default_factory=list)
    mini_app_enabled: bool = False
    user_share: dict[str, bool] = field(default_factory=dict)  # user_id -> share
    known_users: list[int] = field(default_factory=list)
    downloads: int = 0
    settings_message_id: int | None = None

    def is_owner_user(self, user_id: int, owner_id: int) -> bool:
        return user_id == owner_id

    def touch_user(self, user_id: int) -> None:
        if user_id not in self.known_users:
            self.known_users.append(user_id)

    def set_share(self, user_id: int, value: bool) -> None:
        self.user_share[str(user_id)] = value

    def get_share(self, user_id: int) -> bool:
        return bool(self.user_share.get(str(user_id), False))

    def add_force_channel(self, channel: str) -> str:
        ch = channel.strip()
        if not ch:
            return "القيمة فارغة."
        if ch in self.force_sub_channels:
            return "هذه القناة مضافة مسبقاً."
        if len(self.force_sub_channels) >= 2:
            return "الحد الأقصى قناتان. احذف واحدة أولاً."
        self.force_sub_channels.append(ch)
        return f"تمت إضافة القناة: {ch}"

    def remove_force_channel(self, channel: str | None = None) -> str:
        if not self.force_sub_channels:
            return "لا توجد قنوات اشتراك إجباري."
        if channel:
            ch = channel.strip()
            if ch in self.force_sub_channels:
                self.force_sub_channels.remove(ch)
                return f"تم حذف القناة: {ch}"
            return "القناة غير موجودة في القائمة."
        removed = self.force_sub_channels.pop()
        return f"تم حذف القناة: {removed}"

    def clear_force_channels(self) -> str:
        self.force_sub_channels = []
        return "تم إلغاء كل قنوات الاشتراك الإجباري."

    def to_json(self) -> str:
        return json.dumps(
            {
                "force_sub_channels": self.force_sub_channels,
                "mini_app_enabled": self.mini_app_enabled,
                "user_share": self.user_share,
                "known_users": self.known_users[-5000:],
                "downloads": self.downloads,
            },
            ensure_ascii=False,
        )

    def load_json(self, raw: str) -> None:
        data = json.loads(raw)
        self.force_sub_channels = list(data.get("force_sub_channels") or [])[:2]
        self.mini_app_enabled = bool(data.get("mini_app_enabled"))
        self.user_share = dict(data.get("user_share") or {})
        self.known_users = [int(x) for x in (data.get("known_users") or [])]
        self.downloads = int(data.get("downloads") or 0)


store = Store()


async def persist(bot: "Bot", archive_channel_id: str | None) -> None:
    if not archive_channel_id:
        return
    text = f"{SETTINGS_MARKER}\n{store.to_json()}"
    try:
        if store.settings_message_id:
            await bot.edit_message_text(
                chat_id=archive_channel_id,
                message_id=store.settings_message_id,
                text=text,
            )
        else:
            msg = await bot.send_message(
                chat_id=archive_channel_id,
                text=text,
                disable_notification=True,
            )
            store.settings_message_id = msg.message_id
    except Exception as e:
        logger.warning("persist settings failed: %s", e)
        try:
            msg = await bot.send_message(
                chat_id=archive_channel_id,
                text=text,
                disable_notification=True,
            )
            store.settings_message_id = msg.message_id
        except Exception as e2:
            logger.warning("persist retry failed: %s", e2)
