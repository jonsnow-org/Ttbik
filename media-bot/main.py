"""Media Download Bot — perks, summary, squads, clone, Mini App feed."""

from __future__ import annotations

import asyncio
import collections
import hashlib
import json
import logging
import os
import shutil
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from telegram import Update
from telegram.error import Conflict, NetworkError, TimedOut
from telegram.ext import (
    Application,
    ApplicationHandlerStop,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    ContextTypes,
    filters,
)

from config import Config
from keyboards import (
    owner_main_keyboard,
    user_main_keyboard,
    quality_keyboard,
    owner_force_sub_keyboard,
    user_settings_keyboard,
    squad_keyboard,
    menu_button_webapp,
    INFO_TEXT,
)
from services.force_sub import require_subscription
from services.rewards import refresh_bonus
from services.downloader import extract_info, download_media, normalize_url, EXTRACT_TIMEOUT
from services.archive import (
    get_cached_file_id,
    archive_and_get_file_id,
    send_from_cache_or_file,
    set_cached_file_id,
)
from services.store import store, persist, load_from_archive, PREMIUM_DAILY_LIMIT
from services.feed import publish_feed_item, find_local, increment_clone
from services.subtitles import youtube_subtitle_summary, guess_tags
from services.premium import verify_premium_code

logging.basicConfig(format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO)
# httpx logs every request URL at INFO, and Telegram URLs contain the bot token.
logging.getLogger("httpx").setLevel(logging.WARNING)
logger = logging.getLogger(__name__)


def _squad_kb(user_id: int):
    code = store.get_user_squad(user_id)
    members = 0
    if code and code in store.squads:
        members = len(store.squads[code].get("members") or [])
    return squad_keyboard(bool(code), code, members)


cfg = Config.from_env()
_pending_url: dict[int, str] = {}
_pending_meta: dict[int, dict] = {}
_waiting_channel: set[int] = set()
_waiting_squad_join: set[int] = set()
_pending_message_target: dict[int, str] = {}

if cfg.force_sub_channel and not store.force_sub_channels:
    store.force_sub_channels = [cfg.force_sub_channel]
store.mini_app_enabled = True
store.set_share(cfg.owner_id, True)


def _yt_dlp_version() -> str:
    try:
        import yt_dlp
        return yt_dlp.version.__version__
    except Exception as e:
        return f"غير معروف ({e})"


# Webhook mode (owner rule: everything stays on free tiers). On Render's free
# plan the service sleeps after 15 idle minutes; Telegram's webhook POST is
# inbound traffic that wakes it, so the bot only burns instance hours while
# people actually use it. Polling (outbound) never wakes a sleeping service,
# which is why the old version had to keep itself awake 24/7.
WEBHOOK_BASE = (os.environ.get("WEBHOOK_BASE_URL") or os.environ.get("RENDER_EXTERNAL_URL") or "").strip().rstrip("/")
# Derived from the token, so revoking the token also rotates the webhook secret.
_HOOK_SECRET = hashlib.sha256(cfg.bot_token.encode()).hexdigest()[:48]
_HOOK_PATH = f"/tg/{_HOOK_SECRET[:24]}"
_MAX_BODY = 2 * 1024 * 1024
_hook_ready = threading.Event()
_hook_loop: asyncio.AbstractEventLoop | None = None
_hook_app: Application | None = None


# Update ids already handed to the bot in this process. The Vercel front door
# (below) may both forward an update and queue it when it can't confirm
# delivery (e.g. a slow cold start), so replays must be idempotent.
_seen_ids: set[int] = set()
_seen_order: collections.deque[int] = collections.deque()


def _first_time(update_id) -> bool:
    if not isinstance(update_id, int):
        return True
    if update_id in _seen_ids:
        return False
    _seen_ids.add(update_id)
    _seen_order.append(update_id)
    if len(_seen_order) > 5000:
        _seen_ids.discard(_seen_order.popleft())
    return True


async def _enqueue_update(data: dict) -> None:
    assert _hook_app is not None
    if not _first_time(data.get("update_id")):
        return
    update = Update.de_json(data, _hook_app.bot)
    if update:
        await _hook_app.update_queue.put(update)


class _HttpHandler(BaseHTTPRequestHandler):
    def _reply(self, code: int, body: bytes = b"ok") -> None:
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._reply(200)

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        if self.path != _HOOK_PATH or self.headers.get("X-Telegram-Bot-Api-Secret-Token") != _HOOK_SECRET:
            self._reply(403, b"forbidden")
            return
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > _MAX_BODY:
            self._reply(400, b"bad request")
            return
        try:
            data = json.loads(self.rfile.read(length))
        except Exception:
            self._reply(400, b"bad request")
            return
        # A cold start can deliver the waking request before the bot has
        # finished loading; a non-200 makes Telegram retry it later.
        if not _hook_ready.wait(50) or _hook_loop is None:
            self._reply(503, b"starting")
            return
        asyncio.run_coroutine_threadsafe(_enqueue_update(data), _hook_loop)
        self._reply(200)

    def log_message(self, format, *args):
        return


def _start_http_server() -> None:
    port = int(os.environ.get("PORT", "10000"))
    server = ThreadingHTTPServer(("0.0.0.0", port), _HttpHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    logger.info("HTTP server listening on port %s", port)


async def _save(bot) -> None:
    await persist(bot, cfg.archive_channel_id)


async def _force_menu_button(bot) -> None:
    try:
        await bot.set_chat_menu_button(menu_button=menu_button_webapp())
    except Exception as e:
        logger.warning("set_chat_menu_button failed: %s", e)


async def _cold_start_notice(update: Update) -> None:
    now = time.time()
    if now - store.last_wakeup > 12 * 60:
        if update.message:
            await update.message.reply_text("⏳ محرك البوت يستيقظ من وضع التوفير...\nثوانٍ معدودة ويجهز طلبك 🚀")
    store.last_wakeup = now


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not user or not update.message:
        return
    store.touch_user(user.id)
    await _cold_start_notice(update)
    await _force_menu_button(context.bot)
    args = context.args or []
    if args and args[0].startswith("clone_"):
        item_id = args[0].replace("clone_", "", 1)
        item = find_local(item_id)
        if not item:
            from services.feed import _api_url, _secret
            import httpx
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    r = await client.put(_api_url(), json={"id": item_id}, headers={"x-feed-secret": _secret()})
                    if r.status_code < 400:
                        item = (r.json() or {}).get("item")
            except Exception:
                item = None
        if not item:
            await update.message.reply_text("انتهت صلاحية هذا الملف أو غير موجود. حمّل الرابط من جديد.")
            return
        ok, _ = await send_from_cache_or_file(
            context.bot, update.effective_chat.id, item.get("file_id"), None,
            item.get("media_type") or "video", item.get("title") or "media",
        )
        if ok:
            await increment_clone(item_id)
            await update.message.reply_text("⚡ تم الإرسال فوراً من الكاش.")
        else:
            await update.message.reply_text("❌ تعذر الإرسال.")
        return
    if args and args[0].startswith("msg_"):
        target_id = args[0].replace("msg_", "", 1)
        if target_id.isdigit() and int(target_id) != user.id:
            _pending_message_target[user.id] = target_id
            await update.message.reply_text("✍️ اكتب رسالتك الآن وسأرسلها مباشرة لصاحب المحتوى.")
        else:
            await update.message.reply_text("رابط غير صالح.")
        return
    if user.id == cfg.owner_id:
        store.set_share(user.id, True)
        await update.message.reply_text("👑 لوحة مالك البوت\n\nأرسل أي رابط للتحميل مباشرة.", reply_markup=owner_main_keyboard())
        return
    ok = await require_subscription(context.bot, user.id, store.force_sub_channels, update.effective_chat.id)
    if not ok:
        return
    await update.message.reply_text(
        f"مرحباً 👋\nأرسل رابط يوتيوب / تيك توك / إنستغرام...\n\n{store.perk_label(user.id)}",
        reply_markup=user_main_keyboard(),
    )


async def pending_message_relay_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not user or not update.message:
        return
    target = _pending_message_target.get(user.id)
    if not target:
        return
    _pending_message_target.pop(user.id, None)
    text = (update.message.text or "").strip()
    if not text:
        await update.message.reply_text("الرسالة فارغة، لم يتم الإرسال.")
        raise ApplicationHandlerStop
    sender = user.first_name or "مستخدم"
    try:
        await context.bot.send_message(chat_id=int(target), text=f"📩 رسالة جديدة من {sender} (عبر تطبيق الوسائط):\n\n{text}")
        await update.message.reply_text("✅ تم إرسال رسالتك.")
    except Exception as e:
        logger.warning("message relay failed: %s", e)
        await update.message.reply_text("❌ تعذر الإرسال — على الأغلب الطرف الآخر لم يبدأ البوت بعد.")
    raise ApplicationHandlerStop


async def owner_text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user or update.effective_user.id != cfg.owner_id:
        return
    if not update.message:
        return
    text = (update.message.text or "").strip()
    uid = update.effective_user.id
    if uid in _waiting_channel:
        _waiting_channel.discard(uid)
        msg = store.add_force_channel(text)
        await _save(context.bot)
        await update.message.reply_text(msg, reply_markup=owner_force_sub_keyboard(store.force_sub_channels))
        return
    if text == "📊 إحصائيات":
        s = store.bot_stats()
        await update.message.reply_text(
            "📊 لوحة إحصائيات البوت\n"
            "(منضمّو البوت فقط — غير مستخدمي التطبيق)\n\n"
            f"👥 إجمالي المستخدمين: {s['users']}\n"
            f"🆕 منضمّون آخر 24س: {s['new_24h']}\n"
            f"🟢 نشطون آخر 24س: {s['active_24h']}\n"
            f"⚡ متصلون (15 د): {s['online_15m']}\n"
            f"⬇️ إجمالي التحميلات: {s['downloads']}\n"
            f"📥 حمّلوا اليوم: {s['active_downloaders_today']}\n"
            f"🏠 الغرف الخاصة: {s['squads']}\n"
            f"🌐 نشر عام مفعّل: {s['share_public']}\n"
            f"🔐 نشر غرفة مفعّل: {s['share_room']}\n"
            f"📢 قنوات الاشتراك: {s['force_sub']}"
        )
    elif text in ("📢 قنوات الاشتراك", "📢 قناة الاشتراك الإجباري"):
        current = "\n".join(store.force_sub_channels) if store.force_sub_channels else "لا توجد قنوات"
        await update.message.reply_text(f"قنوات الاشتراك الإجباري:\n{current}\n\nحتى قناتين.", reply_markup=owner_force_sub_keyboard(store.force_sub_channels))
    elif text == "⚙️ إعدادات البوت":
        chans = ", ".join(store.force_sub_channels) or "لا"
        await update.message.reply_text(
            f"• الأرشيف: {cfg.archive_channel_id or 'غير محددة'}\n"
            f"• الاشتراك: {chans}\n• Mini-App: مفعّل\n• yt-dlp: {_yt_dlp_version()}"
        )
    elif text == "👥 إدارة المستخدمين":
        s = store.bot_stats()
        await update.message.reply_text(
            f"👥 إدارة مستخدمي البوت\n\nالإجمالي: {s['users']}\nجدد 24س: {s['new_24h']}\nمتصلون: {s['online_15m']}"
        )
    elif text == "💎 الميزات المدفوعة":
        s = store.bot_stats()
        await update.message.reply_text(f"💎 عدد المشتركين في الترقية المدفوعة: {s['premium']}")
    elif text == "ℹ️ معلومات":
        await update.message.reply_text(INFO_TEXT)
    elif text.startswith("http"):
        await _handle_url(update, context, text)
    else:
        await update.message.reply_text("أرسل رابطاً أو استخدم الأزرار.", reply_markup=owner_main_keyboard())


async def user_text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user or not update.message:
        return
    if update.effective_user.id == cfg.owner_id:
        return
    user = update.effective_user
    store.touch_user(user.id)
    text = (update.message.text or "").strip()
    if user.id in _waiting_squad_join:
        _waiting_squad_join.discard(user.id)
        msg = store.join_squad(user.id, text)
        await _save(context.bot)
        await update.message.reply_text(msg, reply_markup=_squad_kb(user.id))
        return
    ok = await require_subscription(context.bot, user.id, store.force_sub_channels, update.effective_chat.id)
    if not ok:
        return
    if text == "📥 تحميل وسائط":
        await update.message.reply_text("أرسل الرابط مباشرة وسأعرض الخيارات.")
    elif text == "⚙️ إعداداتي":
        await refresh_bonus(store, user.id)
        code = store.get_user_squad(user.id)
        await update.message.reply_text(
            f"إعداداتك:\n{store.perk_label(user.id)}\n"
            f"اليوم: {store.daily_count(user.id)}/{store.daily_limit(user.id)}\n\n"
            f"الموجز العام: {'تشغيل' if store.get_share_public(user.id) else 'إيقاف'}\n"
            f"نشر الغرفة: {'تشغيل' if store.get_share_room(user.id) else 'إيقاف'}"
            + (f" ({code})" if code else " (لست في غرفة)"),
            reply_markup=user_settings_keyboard(
                store.get_share_public(user.id),
                store.get_share_room(user.id),
                has_squad=bool(code),
            ),
        )
    elif text == "👥 غرفتي":
        code = store.get_user_squad(user.id)
        if code:
            sq = store.squads.get(code) or {}
            members = len(sq.get("members") or [])
            body = (
                f"👥 الغرف الخاصة\n\n✅ أنت داخل الغرفة: `{code}`\n👥 الأعضاء: {members}\n\n"
                f"كيف تعمل؟\n• شارك الرمز `{code}`\n• ينضمون عبر «الانضمام برمز»\n"
                f"• مع «تفعيل نشر الغرفة» تنزيلاتكم لأعضاء الغرفة فقط\n• لإنشاء غرفة جديدة: غادر الحالية أولاً"
            )
        else:
            body = (
                "👥 الغرف الخاصة\n\nلست في غرفة.\n\n"
                "• إنشاء غرفة → رمز دعوة + تفعيل نشر الغرفة تلقائياً\n"
                "• الانضمام برمز → تدخل غرفة صديقك\n"
                "• تنزيلات الغرفة لا تظهر في الموجز العام"
            )
        await update.message.reply_text(body, parse_mode="Markdown", reply_markup=_squad_kb(user.id))
    elif text == "💎 الترقية المدفوعة":
        await update.message.reply_text(_premium_info_text(user.id))
    elif text in ("ℹ️ معلومات", "❓ مساعدة"):
        await update.message.reply_text(INFO_TEXT)
    elif text.startswith("http"):
        await _handle_url(update, context, text)
    else:
        await update.message.reply_text("أرسل رابطاً أو استخدم الأزرار.", reply_markup=user_main_keyboard())


def _premium_info_text(user_id: int) -> str:
    site = (os.environ.get("NEXT_PUBLIC_SITE_URL") or os.environ.get("SITE_URL") or "https://ttbik.vercel.app").rstrip("/")
    if store.is_premium(user_id):
        return f"💎 الترقية المدفوعة مُفعّلة على حسابك.\nحدك اليومي الحالي: {PREMIUM_DAILY_LIMIT} تحميل."
    return (
        "💎 الترقية المدفوعة\n\n"
        f"• حد يومي أعلى ({PREMIUM_DAILY_LIMIT} تحميل بدل {store.daily_limit(user_id)})\n"
        "• أولوية أعلى في المعالجة\n\n"
        f"1) اطلب الخدمة من: {site}/service/media-bot-premium\n"
        "2) بعد موافقة الإدارة على طلبك، أرسل هنا: /premium ثم رمز طلبك\n"
        "مثال: /premium ABC123"
    )


async def premium_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not user or not update.message:
        return
    store.touch_user(user.id)
    if store.is_premium(user.id):
        await update.message.reply_text(f"💎 الترقية مُفعّلة بالفعل على حسابك.\nحدك اليومي: {PREMIUM_DAILY_LIMIT} تحميل.")
        return
    args = context.args or []
    if not args:
        await update.message.reply_text("استخدم: /premium ثم رمز طلبك، مثال:\n/premium ABC123")
        return
    ok, msg = await verify_premium_code(args[0], user.id)
    if ok:
        store.set_premium(user.id, args[0])
        await _save(context.bot)
    await update.message.reply_text(msg)


async def _handle_url(update: Update, context: ContextTypes.DEFAULT_TYPE, url: str) -> None:
    user = update.effective_user
    if not user or not update.message:
        return
    store.touch_user(user.id)
    is_owner = user.id == cfg.owner_id
    if is_owner:
        store.set_share(user.id, True)
    if not is_owner:
        await refresh_bonus(store, user.id)
    allowed, limit_msg = store.can_download(user.id, is_owner)
    if not allowed:
        await update.message.reply_text(limit_msg)
        return
    status_msg = await update.message.reply_text("⏳ جاري جلب معلومات الرابط...")
    err = ""
    try:
        info, err = await asyncio.wait_for(extract_info(url), timeout=EXTRACT_TIMEOUT + 15)
    except asyncio.TimeoutError:
        info, err = None, "timeout"
    except Exception as e:
        info, err = None, f"{type(e).__name__}: {e}"
    if not info:
        detail = f"\n\n🔧 {err[:200]}" if err and is_owner else ""
        await status_msg.edit_text("❌ تعذر قراءة الرابط.\nجرّب رابطاً مباشراً." + detail)
        return
    _pending_url[user.id] = url
    is_yt = "youtube" in (info.extractor or "").lower() or "youtu" in url.lower()
    _pending_meta[user.id] = {"title": info.title, "thumbnail": info.thumbnail, "extractor": info.extractor, "is_youtube": is_yt}
    duration = f"{int(info.duration) // 60}:{int(info.duration) % 60:02d}" if info.duration else "؟"
    await status_msg.edit_text(f"✅ {info.title[:80]}\n⏱ {duration}\n📊 {limit_msg}\n\nاختر الجودة:", reply_markup=quality_keyboard(show_summary=is_yt))


async def callbacks(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query or not query.from_user:
        return
    await query.answer()
    data = query.data or ""
    user_id = query.from_user.id
    from_user = query.from_user
    is_owner = user_id == cfg.owner_id

    if data == "close_msg":
        await query.edit_message_text("تم.")
        return
    if data == "perk_info":
        code = store.get_user_squad(user_id)
        await query.edit_message_text(
            "🎁 نظام التحفيز:\n• بدون مشاركة: حد أساسي\n• موجز عام: للجميع + حد أعلى\n• غرفة خاصة: لأعضاء غرفتك + حد أعلى\n• يمكن تفعيل الاثنين معاً",
            reply_markup=user_settings_keyboard(store.get_share_public(user_id), store.get_share_room(user_id), has_squad=bool(code)),
        )
        return
    if data == "check_sub":
        ok = await require_subscription(context.bot, user_id, store.force_sub_channels, query.message.chat_id)
        if ok:
            await query.edit_message_text("✅ تم التحقق. أرسل الرابط الآن.")
        return
    if data in ("toggle_share_feed", "share_public_toggle"):
        new_val = not store.get_share_public(user_id)
        store.set_share(user_id, new_val)
        await _save(context.bot)
        code = store.get_user_squad(user_id)
        note = f"✅ الموجز العام: تشغيل\n{store.perk_label(user_id)}" if new_val else f"تم إيقاف الموجز العام.\n{store.perk_label(user_id)}"
        await query.edit_message_text(note, reply_markup=user_settings_keyboard(store.get_share_public(user_id), store.get_share_room(user_id), has_squad=bool(code)))
        return
    if data == "share_room_toggle":
        code = store.get_user_squad(user_id)
        if not code:
            await query.edit_message_text("لست في غرفة. أنشئ غرفة أولاً.", reply_markup=user_settings_keyboard(store.get_share_public(user_id), False, has_squad=False))
            return
        new_val = not store.get_share_room(user_id)
        store.set_share_room(user_id, new_val)
        await _save(context.bot)
        note = (
            f"🏠 نشر الغرفة ({code}): تشغيل\nالتنزيلات لأعضاء الغرفة فقط.\n{store.perk_label(user_id)}"
            if new_val
            else f"تم إيقاف نشر الغرفة.\n{store.perk_label(user_id)}"
        )
        await query.edit_message_text(note, reply_markup=user_settings_keyboard(store.get_share_public(user_id), store.get_share_room(user_id), has_squad=True))
        return
    if data == "share_off":
        store.set_share(user_id, False)
        store.set_share_room(user_id, False)
        await _save(context.bot)
        code = store.get_user_squad(user_id)
        await query.edit_message_text("⏹ تم إيقاف كل النشر.", reply_markup=user_settings_keyboard(False, False, has_squad=bool(code)))
        return

    if data == "squad_create":
        if store.get_user_squad(user_id):
            await query.edit_message_text("أنت بالفعل في غرفة.\nغادرها أولاً.", reply_markup=_squad_kb(user_id))
            return
        code = store.create_squad(user_id)
        await _save(context.bot)
        await query.edit_message_text(
            f"✅ تم إنشاء غرفتك\n\nرمز: `{code}`\n\nتم تفعيل «نشر الغرفة» تلقائياً.\nيمكنك من الإعدادات تفعيل الموجز العام أيضاً أو إيقاف نشر الغرفة.",
            parse_mode="Markdown",
            reply_markup=_squad_kb(user_id),
        )
        return
    if data == "squad_info":
        code = store.get_user_squad(user_id)
        if not code:
            await query.edit_message_text("لست في غرفة.", reply_markup=_squad_kb(user_id))
            return
        sq = store.squads.get(code) or {}
        members = len(sq.get("members") or [])
        room_on = store.get_share_room(user_id)
        await query.edit_message_text(
            f"📋 غرفتك `{code}`\n👥 {members} أعضاء\n🏠 نشر الغرفة: {'تشغيل' if room_on else 'إيقاف'}\n\nالتنزيلات مع نشر الغرفة تظهر للأعضاء فقط وليس في الموجز العام.",
            parse_mode="Markdown",
            reply_markup=_squad_kb(user_id),
        )
        return
    if data == "squad_join":
        _waiting_squad_join.add(user_id)
        await query.edit_message_text("🔑 أرسل رمز الغرفة الآن\nمثال: `8A038B`", parse_mode="Markdown")
        return
    if data == "squad_leave":
        msg = store.leave_squad(user_id)
        await _save(context.bot)
        await query.edit_message_text(f"{msg}\n\nيمكنك إنشاء غرفة جديدة.", reply_markup=_squad_kb(user_id))
        return

    if is_owner:
        if data == "owner_add_force_sub":
            if len(store.force_sub_channels) >= 2:
                await query.edit_message_text("الحد الأقصى قناتان.")
                return
            _waiting_channel.add(user_id)
            await query.edit_message_text("أرسل يوزر القناة أو آيديها.")
            return
        if data == "owner_clear_force_sub":
            await query.edit_message_text(store.clear_force_channels())
            await _save(context.bot)
            return
        if data.startswith("owner_del_force_"):
            try:
                idx = int(data.rsplit("_", 1)[-1])
                ch = store.force_sub_channels[idx]
                store.remove_force_channel(ch)
                await _save(context.bot)
                await query.edit_message_text(f"تم حذف {ch}", reply_markup=owner_force_sub_keyboard(store.force_sub_channels))
            except Exception:
                await query.edit_message_text("تعذر الحذف.")
            return

    if data == "dl_summary":
        url = _pending_url.get(user_id)
        if not url:
            await query.edit_message_text("انتهت صلاحية الطلب.")
            return
        await query.edit_message_text("🧠 جاري التلخيص...")
        points, lang = await youtube_subtitle_summary(normalize_url(url))
        if not points:
            await query.edit_message_text("تعذر جلب ترجمة.", reply_markup=quality_keyboard(show_summary=False))
            return
        body = "\n".join(f"• {p}" for p in points)
        await query.edit_message_text(f"🧠 ملخص ({lang or 'auto'}):\n\n{body}\n\nهل تريد التحميل؟", reply_markup=quality_keyboard(show_summary=False))
        return

    url = _pending_url.get(user_id)
    if data == "dl_cancel":
        _pending_url.pop(user_id, None)
        _pending_meta.pop(user_id, None)
        await query.edit_message_text("تم الإلغاء.")
        return

    mapping = {"dl_720": ("720", "video"), "dl_480": ("480", "video"), "dl_360": ("360", "video"), "dl_audio": ("best", "audio"), "dl_voice": ("best", "voice")}
    if data not in mapping:
        return
    if not url:
        await query.edit_message_text("انتهت صلاحية الطلب.")
        return

    if not is_owner:
        await refresh_bonus(store, user_id)
    allowed, limit_msg = store.can_download(user_id, is_owner)
    if not allowed:
        await query.edit_message_text(limit_msg)
        return

    quality, media_type = mapping[data]
    meta = _pending_meta.get(user_id) or {}
    dname = getattr(from_user, "first_name", None) or "مستخدم"

    cached = get_cached_file_id(url, media_type, quality) or store.file_cache.get(f"{url}|{media_type}|{quality}")
    if cached:
        await query.edit_message_text("⚡ من الأرشيف...")
        ok, fid = await send_from_cache_or_file(context.bot, query.message.chat_id, cached, None, media_type, meta.get("title") or "cached")
        if ok:
            store.record_download(user_id)
            await _maybe_publish_feed(user_id=user_id, file_id=fid or cached, media_type=media_type, title=meta.get("title") or "media", url=url, thumbnail=meta.get("thumbnail"), from_user=from_user)
            await _save(context.bot)
            await query.edit_message_text(f"✅ تم · {limit_msg}")
            return

    await query.edit_message_text("⬇️ جاري التحميل...")
    try:
        result, dl_err = await download_media(url, quality=quality, media_type=media_type)
    except Exception as e:
        result, dl_err = None, str(e)
    if not result:
        detail = f"\n\n{(dl_err or '')[:250]}" if dl_err and is_owner else ""
        await query.edit_message_text("❌ فشل التحميل." + detail)
        return

    file_id = await archive_and_get_file_id(
        context.bot, cfg.archive_channel_id, str(result.path), url, media_type, quality, result.title,
        downloader_name=dname, downloader_id=user_id,
    )
    ok, sent_id = await send_from_cache_or_file(context.bot, query.message.chat_id, file_id, str(result.path), media_type, result.title)
    try:
        parent = result.path.parent
        if parent.exists() and str(parent).startswith("/tmp"):
            shutil.rmtree(parent, ignore_errors=True)
    except Exception:
        pass
    if ok:
        store.record_download(user_id)
        await _maybe_publish_feed(user_id=user_id, file_id=sent_id or file_id or "", media_type=media_type, title=result.title or meta.get("title") or "media", url=url, thumbnail=meta.get("thumbnail") or getattr(result, "thumbnail", None), from_user=from_user)
        await _save(context.bot)
        await query.edit_message_text(f"✅ تم · {limit_msg}")
    else:
        await query.edit_message_text("❌ تعذر إرسال الملف.")


async def _maybe_publish_feed(*, user_id: int, file_id: str, media_type: str, title: str, url: str, thumbnail: str | None, from_user) -> None:
    if not file_id:
        return
    is_owner = user_id == cfg.owner_id
    pub = store.get_share_public(user_id) or is_owner
    room = store.get_share_room(user_id)
    squad = store.get_user_squad(user_id)
    if not pub and not (room and squad):
        return
    name = getattr(from_user, "first_name", None) or "مستخدم"
    tags = guess_tags(title, "")
    try:
        if pub:
            await publish_feed_item(
                file_id=file_id, media_type=media_type, title=title, url=url or "",
                thumbnail=thumbnail or "", sharer_name=name, sharer_id=str(user_id),
                tags=tags, squad_code="",
            )
        if room and squad:
            await publish_feed_item(
                file_id=file_id, media_type=media_type, title=title, url=url or "",
                thumbnail=thumbnail or "", sharer_name=name, sharer_id=str(user_id),
                tags=tags, squad_code=squad,
            )
    except Exception as e:
        logger.warning("publish_feed_item failed: %s", e)


async def version_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message:
        await update.message.reply_text(f"yt-dlp: {_yt_dlp_version()}")


async def _error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Registered so a Conflict/NetworkError/TimedOut (already imported
    above but never actually wired to anything) is at least logged
    clearly instead of vanishing into python-telegram-bot's default
    handling. Does not by itself stop main()'s outer retry loop below
    from restarting polling -- that loop is what actually recovers."""
    err = context.error
    if isinstance(err, Conflict):
        logger.error("Telegram Conflict (another poller likely running briefly during a deploy): %s", err)
    elif isinstance(err, (NetworkError, TimedOut)):
        logger.warning("Network error talking to Telegram: %s", err)
    else:
        logger.exception("Unhandled error while processing an update", exc_info=err)


def _build_app() -> Application:
    app = (
        Application.builder()
        .token(cfg.bot_token)
        .connect_timeout(30.0)
        .read_timeout(30.0)
        .write_timeout(30.0)
        .pool_timeout(30.0)
        .build()
    )
    app.add_error_handler(_error_handler)
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("version", version_cmd))
    app.add_handler(CommandHandler("premium", premium_cmd))
    # Distinct groups: PTB runs only the first matching handler per group, and
    # owner_text_handler's filter matches every text (owner check is inside it).
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, pending_message_relay_handler), group=-1)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, owner_text_handler), group=0)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, user_text_handler), group=1)
    app.add_handler(CallbackQueryHandler(callbacks))
    return app


async def _startup(application: Application) -> None:
    await load_from_archive(application.bot, cfg.archive_channel_id)
    await _force_menu_button(application.bot)


# ---------------------------------------------------------------------------
# Vercel front door (src/lib/mediaFrontDoor.ts on the site): Telegram's webhook
# points at Vercel, which is always on and forwards every update here. When
# this Render service is suspended (free hours used up) or down, Vercel keeps
# answering users, serves mini-app "clone" links from the file_id cache, and
# saves download links; they are pulled back from there and replayed below.
# Set MEDIA_FRONT_DOOR=off to point Telegram straight at Render as before.
def _front_door_base() -> str:
    if os.environ.get("MEDIA_FRONT_DOOR", "").strip().lower() in ("off", "0", "false", "no"):
        return ""
    from services.feed import _api_url
    from urllib.parse import urlsplit

    u = urlsplit(_api_url())
    return f"{u.scheme}://{u.netloc}" if u.scheme and u.netloc else ""


async def _register_front_door() -> str:
    """Tell the site where this bot lives; returns the webhook URL to use there, or ''."""
    base = _front_door_base()
    if not base or not WEBHOOK_BASE.startswith("https://"):
        return ""
    import httpx

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(
                f"{base}/api/media-bot/front-door",
                json={"render_url": WEBHOOK_BASE},
                headers={"x-media-bot-key": _HOOK_SECRET},
            )
        if r.status_code == 200:
            return f"{base}/api/media-bot/webhook"
        logger.warning("Front door registration refused (%s) — using direct webhook.", r.status_code)
    except Exception as e:
        logger.warning("Front door unreachable (%s) — using direct webhook.", e)
    return ""


async def _drain_front_door_queue() -> None:
    """Replay download links the front door saved while this service was down."""
    base = _front_door_base()
    if not base:
        return
    import httpx

    while True:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.get(f"{base}/api/media-bot/front-door", headers={"x-media-bot-key": _HOOK_SECRET})
            updates = (r.json() or {}).get("updates") or [] if r.status_code == 200 else []
            for data in updates:
                if isinstance(data, dict):
                    await _enqueue_update(data)
            if updates:
                logger.info("Replayed %s queued update(s) from the front door.", len(updates))
                continue  # there may be more
        except Exception as e:
            logger.warning("Front door queue check failed: %s", e)
        # Outbound only — it never keeps the Render service awake.
        await asyncio.sleep(30)


async def _run_webhook() -> None:
    global _hook_loop, _hook_app
    app = _build_app()
    _hook_loop = asyncio.get_running_loop()
    _hook_app = app
    await app.initialize()
    await _startup(app)
    await app.start()
    # Re-registered on every wake-up: cheap, and keeps the URL right after a
    # token change or service rename. Pending updates are kept (not dropped)
    # because the message that woke the service is one of them.
    front_door = await _register_front_door()
    await app.bot.set_webhook(
        url=front_door or f"{WEBHOOK_BASE}{_HOOK_PATH}",
        secret_token=_HOOK_SECRET,
        allowed_updates=Update.ALL_TYPES,
        max_connections=10,
    )
    _hook_ready.set()
    logger.info("Bot running (webhook mode, %s).", "via Vercel front door" if front_door else "direct")
    drain = asyncio.create_task(_drain_front_door_queue()) if front_door else None
    try:
        await asyncio.Event().wait()
    finally:
        if drain:
            drain.cancel()
        _hook_ready.clear()
        await app.stop()
        await app.shutdown()


def _run_polling() -> None:
    async def _post_init(application: Application) -> None:
        for attempt in range(3):
            try:
                await application.bot.delete_webhook(drop_pending_updates=True)
                break
            except Exception as e:
                logger.warning("delete_webhook attempt %s/3 failed: %s", attempt + 1, e)
                await asyncio.sleep(2)
        await _startup(application)

    app = _build_app()
    app.post_init = _post_init
    logger.info("Bot starting (polling, no WEBHOOK_BASE_URL/RENDER_EXTERNAL_URL)...")
    app.run_polling(
        drop_pending_updates=True,
        allowed_updates=Update.ALL_TYPES,
        bootstrap_retries=5,
        poll_interval=1.0,
        timeout=25,
    )


def main() -> None:
    _start_http_server()
    # Restart loop: if the bot loop ever stops or crashes, the same process
    # resumes within seconds instead of going silent until a manual redeploy.
    while True:
        try:
            if WEBHOOK_BASE:
                asyncio.run(_run_webhook())
            else:
                _run_polling()
            logger.warning("Bot loop returned — restarting in 5s.")
        except Exception:
            logger.exception("Bot loop crashed — restarting in 5s.")
        time.sleep(5)


if __name__ == "__main__":
    main()
