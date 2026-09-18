"""In-memory store + archive-channel persistence."""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from telegram import Bot

logger = logging.getLogger(__name__)

SETTINGS_MARKER = "#MB_SETTINGS"
FREE_DAILY_LIMIT = 8
SHARE_DAILY_LIMIT = 20  # Engagement-to-Perks: higher limit when share ON


@dataclass
class Store:
    force_sub_channels: list[str] = field(default_factory=list)
    mini_app_enabled: bool = True
    user_share: dict[str, bool] = field(default_factory=dict)
    known_users: list[int] = field(default_factory=list)
    downloads: int = 0
    # user_id -> {"date": "YYYY-MM-DD", "count": n}
    daily_usage: dict[str, dict] = field(default_factory=dict)
    # file cache key -> file_id (survives via persist)
    file_cache: dict[str, str] = field(default_factory=dict)
    # squad_code -> {"owner": uid, "members": [uids], "name": str}
    squads: dict[str, dict] = field(default_factory=dict)
    user_squad: dict[str, str] = field(default_factory=dict)  # user_id -> squad_code
    settings_message_id: int | None = None
    last_wakeup: float = 0.0

    def touch_user(self, user_id: int) -> None:
        if user_id not in self.known_users:
            self.known_users.append(user_id)

    def set_share(self, user_id: int, value: bool) -> None:
        self.user_share[str(user_id)] = value

    def get_share(self, user_id: int) -> bool:
        return bool(self.user_share.get(str(user_id), False))

    def _today(self) -> str:
        return time.strftime("%Y-%m-%d", time.gmtime())

    def daily_count(self, user_id: int) -> int:
        key = str(user_id)
        row = self.daily_usage.get(key) or {}
        if row.get("date") != self._today():
            return 0
        return int(row.get("count") or 0)

    def daily_limit(self, user_id: int, is_owner: bool = False) -> int:
        if is_owner:
            return 10_000
        return SHARE_DAILY_LIMIT if self.get_share(user_id) else FREE_DAILY_LIMIT

    def can_download(self, user_id: int, is_owner: bool = False) -> tuple[bool, str]:
        limit = self.daily_limit(user_id, is_owner)
        used = self.daily_count(user_id)
        if used >= limit:
            if self.get_share(user_id):
                return False, f"وصلت للحد اليومي ({limit}). حاول غداً."
            return (
                False,
                f"وصلت للحد المجاني ({FREE_DAILY_LIMIT}/يوم).\n"
                f"فعّل المشاركة من إعداداتي لرفع الحد إلى {SHARE_DAILY_LIMIT}.",
            )
        return True, f"{used + 1}/{limit}"

    def record_download(self, user_id: int) -> None:
        key = str(user_id)
        today = self._today()
        row = self.daily_usage.get(key) or {}
        if row.get("date") != today:
            row = {"date": today, "count": 0}
        row["count"] = int(row.get("count") or 0) + 1
        self.daily_usage[key] = row
        self.downloads += 1

    def perk_label(self, user_id: int) -> str:
        if self.get_share(user_id):
            return "🏅 مساهم مميز · حد يومي مرتفع"
        return "حد مجاني عادي — فعّل المشاركة لمضاعفة الحد"

    # ---- squads ----
    def create_squad(self, owner_id: int, name: str = "غرفة خاصة") -> str:
        import secrets

        code = secrets.token_hex(3).upper()  # 6 hex chars
        self.squads[code] = {
            "owner": owner_id,
            "members": [owner_id],
            "name": (name or "غرفة خاصة")[:40],
            "created_at": int(time.time()),
        }
        self.user_squad[str(owner_id)] = code
        return code

    def join_squad(self, user_id: int, code: str) -> str:
        code = (code or "").strip().upper()
        sq = self.squads.get(code)
        if not sq:
            return "رمز الغرفة غير صحيح."
        members = list(sq.get("members") or [])
        if user_id not in members:
            members.append(user_id)
            sq["members"] = members
        self.user_squad[str(user_id)] = code
        return f"انضممت إلى «{sq.get('name', code)}» ({len(members)} أعضاء)."

    def leave_squad(self, user_id: int) -> str:
        code = self.user_squad.pop(str(user_id), None)
        if not code:
            return "لست في أي غرفة."
        sq = self.squads.get(code)
        if sq and user_id in (sq.get("members") or []):
            sq["members"] = [m for m in sq["members"] if m != user_id]
        return "غادرت الغرفة."

    def get_user_squad(self, user_id: int) -> str | None:
        return self.user_squad.get(str(user_id))

    # ---- force sub ----
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
                "daily_usage": self.daily_usage,
                "file_cache": dict(list(self.file_cache.items())[-500:]),
                "squads": self.squads,
                "user_squad": self.user_squad,
            },
            ensure_ascii=False,
        )

    def load_json(self, raw: str) -> None:
        data = json.loads(raw)
        self.force_sub_channels = list(data.get("force_sub_channels") or [])[:2]
        self.mini_app_enabled = bool(data.get("mini_app_enabled", True))
        self.user_share = dict(data.get("user_share") or {})
        self.known_users = [int(x) for x in (data.get("known_users") or [])]
        self.downloads = int(data.get("downloads") or 0)
        self.daily_usage = dict(data.get("daily_usage") or {})
        self.file_cache = dict(data.get("file_cache") or {})
        self.squads = dict(data.get("squads") or {})
        self.user_squad = dict(data.get("user_squad") or {})


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


async def load_from_archive(bot: "Bot", archive_channel_id: str | None) -> None:
    """Best-effort: scan recent channel messages for SETTINGS_MARKER."""
    if not archive_channel_id:
        return
    try:
        # Telegram Bot API cannot freely history-scan; owner can forward.
        # We rely on in-process memory + last persist message id if known.
        logger.info("store load: using in-memory + last persist (channel scan limited by Bot API)")
    except Exception as e:
        logger.warning("load_from_archive: %s", e)
