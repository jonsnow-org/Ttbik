"""In-memory store + archive-channel persistence (as document)."""

from __future__ import annotations

import io
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
SHARE_DAILY_LIMIT = 20


@dataclass
class Store:
    force_sub_channels: list[str] = field(default_factory=list)
    mini_app_enabled: bool = True
    # public feed share
    user_share: dict[str, bool] = field(default_factory=dict)
    # private room share (only when user is in a squad)
    user_share_room: dict[str, bool] = field(default_factory=dict)
    known_users: list[int] = field(default_factory=list)
    # user_id -> unix ts first seen / last seen
    user_joined: dict[str, int] = field(default_factory=dict)
    user_last_seen: dict[str, int] = field(default_factory=dict)
    downloads: int = 0
    daily_usage: dict[str, dict] = field(default_factory=dict)
    file_cache: dict[str, str] = field(default_factory=dict)
    squads: dict[str, dict] = field(default_factory=dict)
    user_squad: dict[str, str] = field(default_factory=dict)
    settings_message_id: int | None = None
    last_wakeup: float = 0.0
    last_persist_ts: float = 0.0

    def touch_user(self, user_id: int) -> None:
        key = str(user_id)
        now = int(time.time())
        if user_id not in self.known_users:
            self.known_users.append(user_id)
        if key not in self.user_joined:
            self.user_joined[key] = now
        self.user_last_seen[key] = now

    def set_share(self, user_id: int, value: bool) -> None:
        """Public feed share."""
        self.user_share[str(user_id)] = value

    def get_share_public(self, user_id: int) -> bool:
        return bool(self.user_share.get(str(user_id), False))

    def set_share_room(self, user_id: int, value: bool) -> None:
        self.user_share_room[str(user_id)] = value

    def get_share_room(self, user_id: int) -> bool:
        return bool(self.user_share_room.get(str(user_id), False))

    def get_share(self, user_id: int) -> bool:
        """Perk / higher limit: active if public OR room share is on."""
        return self.get_share_public(user_id) or self.get_share_room(user_id)

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
                f"فعّل المشاركة (عام أو غرفة) لرفع الحد إلى {SHARE_DAILY_LIMIT}.",
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
        pub = self.get_share_public(user_id)
        room = self.get_share_room(user_id)
        if pub and room:
            return "🏅 مساهم · موجز عام + غرفة خاصة"
        if pub:
            return "🏅 مساهم · موجز عام"
        if room:
            return "🏠 مساهم · غرفة خاصة فقط"
        return "حد مجاني عادي — فعّل المشاركة لمضاعفة الحد"

    def create_squad(self, owner_id: int, name: str = "غرفة خاصة") -> str:
        import secrets

        code = secrets.token_hex(3).upper()
        self.squads[code] = {
            "owner": owner_id,
            "members": [owner_id],
            "name": (name or "غرفة خاصة")[:40],
            "created_at": int(time.time()),
        }
        self.user_squad[str(owner_id)] = code
        # default: publish downloads into this room only
        self.set_share_room(owner_id, True)
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
        self.set_share_room(user_id, True)
        return f"انضممت إلى «{sq.get('name', code)}» ({len(members)} أعضاء).\nتم تفعيل نشر تنزيلاتك داخل الغرفة تلقائياً."

    def leave_squad(self, user_id: int) -> str:
        code = self.user_squad.pop(str(user_id), None)
        if not code:
            return "لست في أي غرفة."
        sq = self.squads.get(code)
        if sq and user_id in (sq.get("members") or []):
            sq["members"] = [m for m in sq["members"] if m != user_id]
        self.set_share_room(user_id, False)
        return "غادرت الغرفة. تم إيقاف نشر الغرفة."

    def get_user_squad(self, user_id: int) -> str | None:
        return self.user_squad.get(str(user_id))

    def bot_stats(self) -> dict:
        now = int(time.time())
        day = 86400
        today = self._today()
        new_24h = sum(1 for ts in self.user_joined.values() if now - int(ts) < day)
        active_24h = sum(1 for ts in self.user_last_seen.values() if now - int(ts) < day)
        online_15m = sum(1 for ts in self.user_last_seen.values() if now - int(ts) < 15 * 60)
        active_today_dl = sum(
            1
            for row in self.daily_usage.values()
            if row.get("date") == today and int(row.get("count") or 0) > 0
        )
        pub = sum(1 for v in self.user_share.values() if v)
        room = sum(1 for v in self.user_share_room.values() if v)
        return {
            "users": len(self.known_users),
            "new_24h": new_24h,
            "active_24h": active_24h,
            "online_15m": online_15m,
            "downloads": self.downloads,
            "active_downloaders_today": active_today_dl,
            "squads": len(self.squads),
            "share_public": pub,
            "share_room": room,
            "force_sub": len(self.force_sub_channels),
        }

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
                "user_share_room": self.user_share_room,
                "known_users": self.known_users[-5000:],
                "user_joined": dict(list(self.user_joined.items())[-5000:]),
                "user_last_seen": dict(list(self.user_last_seen.items())[-5000:]),
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
        self.user_share_room = dict(data.get("user_share_room") or {})
        self.known_users = [int(x) for x in (data.get("known_users") or [])]
        self.user_joined = {str(k): int(v) for k, v in (data.get("user_joined") or {}).items()}
        self.user_last_seen = {str(k): int(v) for k, v in (data.get("user_last_seen") or {}).items()}
        self.downloads = int(data.get("downloads") or 0)
        self.daily_usage = dict(data.get("daily_usage") or {})
        self.file_cache = dict(data.get("file_cache") or {})
        self.squads = dict(data.get("squads") or {})
        self.user_squad = dict(data.get("user_squad") or {})


store = Store()


async def persist(bot: "Bot", archive_channel_id: str | None) -> None:
    """Save settings as a silent DOCUMENT (not a visible JSON text message)."""
    if not archive_channel_id:
        return
    now = time.time()
    if now - store.last_persist_ts < 30:
        return
    store.last_persist_ts = now

    payload = store.to_json().encode("utf-8")
    bio = io.BytesIO(payload)
    bio.name = "mb_settings.json"

    try:
        msg = await bot.send_document(
            chat_id=archive_channel_id,
            document=bio,
            caption=SETTINGS_MARKER,
            disable_notification=True,
        )
        try:
            if store.settings_message_id:
                await bot.unpin_chat_message(chat_id=archive_channel_id, message_id=store.settings_message_id)
        except Exception:
            pass
        try:
            await bot.pin_chat_message(chat_id=archive_channel_id, message_id=msg.message_id, disable_notification=True)
        except Exception as e:
            logger.warning("pin settings document failed: %s", e)
        store.settings_message_id = msg.message_id
        logger.info("settings persisted as document msg=%s", msg.message_id)
    except Exception as e:
        logger.warning("persist settings document failed: %s", e)


async def load_from_archive(bot: "Bot", archive_channel_id: str | None) -> None:
    if not archive_channel_id:
        return
    try:
        chat = await bot.get_chat(archive_channel_id)
        pinned = chat.pinned_message
        if not pinned or not pinned.document:
            logger.info("store load: no pinned settings document in archive channel")
            return
        if SETTINGS_MARKER not in (pinned.caption or ""):
            logger.info("store load: pinned message isn't a settings snapshot")
            return
        tg_file = await bot.get_file(pinned.document.file_id)
        raw = await tg_file.download_as_bytearray()
        store.load_json(bytes(raw).decode("utf-8"))
        store.settings_message_id = pinned.message_id
        logger.info(
            "store load: restored %d known users, %d squads, %d force-sub channel(s)",
            len(store.known_users),
            len(store.squads),
            len(store.force_sub_channels),
        )
    except Exception as e:
        logger.warning("store load from archive failed: %s", e)
