"""Media Download Bot — owner/user panels, downloads, Mini App feed publish, clone."""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from telegram import Update
from telegram.error import Conflict, NetworkError, TimedOut
from telegram.ext import (
    Application,
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
    menu_button_webapp,
    INFO_TEXT,
)
from services.force_sub import require_subscription
from services.downloader import extract_info, download_media
from services.archive import (
    get_cached_file_id,
    archive_and_get_file_id,
    send_from_cache_or_file,
    set_cached_file_id,
)
from services.store import store, persist
from services.feed import publish_feed_item, find_local

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

cfg = Config.from_env()
_pending_url: dict[int, str] = {}
_pending_meta: dict[int, dict] = {}
_waiting_channel: set[int] = set()

if cfg.force_sub_channel and not store.force_sub_channels:
    store.force_sub_channels = [cfg.force_sub_channel]
# Always keep Mini-App menu button ON (user requirement)
store.mini_app_enabled = True


class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, format, *args):
        return


def _start_health_server() -> None:
    port = int(os.environ.get("PORT", "10000"))
    server = HTTPServer(("0.0.0.0", port), _HealthHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    logger.info("Health server listening on port %s", port)


async def _save(bot) -> None:
    await persist(bot, cfg.archive_channel_id)


async def _force_menu_button(bot) -> None:
    """Always set the WebApp menu button so the square appears next to the input."""
    try:
        await bot.set_chat_menu_button(menu_button=menu_button_webapp())
        logger.info("Menu button Mini-App set")
    except Exception as e:
        logger.warning("set_chat_menu_button failed: %s", e)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not user or not update.message:
        return
    store.touch_user(user.id)
    # Re-assert menu button every /start (Telegram sometimes drops it)
    await _force_menu_button(context.bot)

    args = context.args or []
    if args and args[0].startswith("clone_"):
        item_id = args[0].replace("clone_", "", 1)
        item = find_local(item_id)
        if not item:
            await update.message.reply_text("انتهت صلاحية هذا الملف أو غير موجود. حمّل الرابط من جديد.")
            return
        ok, _ = await send_from_cache_or_file(
            context.bot,
            update.effective_chat.id,
            item.get("file_id"),
            None,
            item.get("media_type") or "video",
            item.get("title") or "media",
        )
        await update.message.reply_text("✅ تم الإرسال فوراً من الكاش." if ok else "❌ تعذر الإرسال.")
        return

    if user.id == cfg.owner_id:
        await update.message.reply_text(
            "👑 لوحة مالك البوت\n\n"
            "أرسل أي رابط للتحميل مباشرة.\n"
            "زر Mini-App المربع بجانب حقل الرسالة يفتح التطبيق المصغر.",
            reply_markup=owner_main_keyboard(),
        )
        return

    ok = await require_subscription(
        context.bot, user.id, store.force_sub_channels, update.effective_chat.id
    )
    if not ok:
        return

    await update.message.reply_text(
        "مرحباً 👋\nأرسل رابط يوتيوب / تيك توك / إنستغرام / تويتر...\n"
        "أو افتح التطبيق المصغر من الزر المربع بجانب الرسالة.",
        reply_markup=user_main_keyboard(True),
    )


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
        await update.message.reply_text(
            msg,
            reply_markup=owner_force_sub_keyboard(store.force_sub_channels),
        )
        return

    if text == "📊 إحصائيات":
        n = len(store.known_users)
        await update.message.reply_text(
            "📊 إحصائيات البوت\n\n"
            f"• عدد المستخدمين المسجّلين: {n}\n"
            f"• عدد التحميلات: {store.downloads}\n"
            f"• قنوات الاشتراك الإجباري: {len(store.force_sub_channels)}\n"
            "• زر Mini-App: مفعّل دائماً"
        )
    elif text in ("📢 قنوات الاشتراك", "📢 قناة الاشتراك الإجباري"):
        current = "\n".join(store.force_sub_channels) if store.force_sub_channels else "لا توجد قنوات"
        await update.message.reply_text(
            f"قنوات الاشتراك الإجباري الحالية:\n{current}\n\nيمكنك إضافة حتى قناتين.",
            reply_markup=owner_force_sub_keyboard(store.force_sub_channels),
        )
    elif text == "⚙️ إعدادات البوت":
        chans = ", ".join(store.force_sub_channels) or "لا"
        await update.message.reply_text(
            f"• قناة الأرشيف: {cfg.archive_channel_id or 'غير محددة'}\n"
            f"• الاشتراك الإجباري: {chans}\n"
            "• زر Mini-App: مفعّل دائماً (بجانب حقل الرسالة)"
        )
    elif text == "👥 إدارة المستخدمين":
        await update.message.reply_text(f"عدد المستخدمين: {len(store.known_users)}")
    elif text == "💎 الميزات المدفوعة":
        await update.message.reply_text("بنية الميزات المدفوعة جاهزة للتفعيل لاحقاً بضغطة زر.")
    elif text == "ℹ️ معلومات":
        await update.message.reply_text(INFO_TEXT)
    elif text.startswith("http"):
        await _handle_url(update, context, text)
    else:
        # تجاهل الأزرار المحذوفة القديمة إن بقيت ظاهرة في الكاش
        if text in ("📱 التطبيق المصغر", "📥 تجربة التحميل", "🌐 الموجز العام"):
            await update.message.reply_text(
                "تم حذف هذا الزر.\n"
                "• للتحميل: أرسل الرابط مباشرة.\n"
                "• للتطبيق المصغر: الزر المربع بجانب حقل الرسالة.",
                reply_markup=owner_main_keyboard(),
            )
            return
        await update.message.reply_text("استخدم الأزرار أو أرسل رابطاً.", reply_markup=owner_main_keyboard())


async def user_text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user or not update.message:
        return
    if update.effective_user.id == cfg.owner_id:
        return

    user = update.effective_user
    store.touch_user(user.id)
    text = (update.message.text or "").strip()

    ok = await require_subscription(
        context.bot, user.id, store.force_sub_channels, update.effective_chat.id
    )
    if not ok:
        return

    if text == "📥 تحميل وسائط":
        await update.message.reply_text("أرسل الرابط مباشرة وسأعرض خيارات الجودة.")
    elif text == "⚙️ إعداداتي":
        share = store.get_share(user.id)
        await update.message.reply_text(
            "إعدادات الخصوصية والمكافآت:\n"
            "• تفعيل المشاركة ينشر تنزيلاتك في التطبيق المصغر.\n"
            "• المكافأة: شارة مساهم في الموجز.\n"
            "• يمكنك الإيقاف في أي وقت.",
            reply_markup=user_settings_keyboard(share),
        )
    elif text in ("ℹ️ معلومات", "❓ مساعدة"):
        await update.message.reply_text(INFO_TEXT)
    elif text.startswith("http"):
        await _handle_url(update, context, text)
    else:
        await update.message.reply_text(
            "أرسل رابطاً أو استخدم الأزرار.",
            reply_markup=user_main_keyboard(True),
        )


async def _handle_url(update: Update, context: ContextTypes.DEFAULT_TYPE, url: str) -> None:
    user = update.effective_user
    if not user or not update.message:
        return
    store.touch_user(user.id)

    status_msg = await update.message.reply_text("⏳ جاري جلب معلومات الرابط (حد أقصى 45 ثانية)...")
    try:
        info = await extract_info(url)
    except Exception:
        info = None

    if not info:
        await status_msg.edit_text(
            "❌ تعذر قراءة الرابط.\n"
            "جرّب يوتيوب / تيك توك / إنستغرام مباشر.\n"
            "روابط فيسبوك المختصرة غالباً تفشل."
        )
        return

    _pending_url[user.id] = url
    _pending_meta[user.id] = {
        "title": info.title,
        "thumbnail": info.thumbnail,
        "extractor": info.extractor,
    }
    duration = f"{info.duration // 60}:{info.duration % 60:02d}" if info.duration else "؟"
    await status_msg.edit_text(
        f"✅ {info.title[:80]}\n⏱ المدة: {duration}\n📡 المصدر: {info.extractor}\n\nاختر الجودة:",
        reply_markup=quality_keyboard(),
    )


async def callbacks(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query or not query.from_user:
        return
    await query.answer()
    data = query.data or ""
    user_id = query.from_user.id

    if data == "close_msg":
        await query.edit_message_text("تم.")
        return

    if data == "check_sub":
        ok = await require_subscription(
            context.bot, user_id, store.force_sub_channels, query.message.chat_id
        )
        if ok:
            await query.edit_message_text("✅ تم التحقق. أرسل الرابط الآن.")
        return

    if data == "toggle_share_feed":
        new_val = not store.get_share(user_id)
        store.set_share(user_id, new_val)
        await _save(context.bot)
        note = (
            "✅ المشاركة مفعّلة — تنزيلاتك قد تظهر في الرائج."
            if new_val
            else "تم إخفاء تنزيلاتك عن التطبيق المصغر."
        )
        await query.edit_message_text(note, reply_markup=user_settings_keyboard(new_val))
        return

    if user_id == cfg.owner_id:
        if data == "owner_add_force_sub":
            if len(store.force_sub_channels) >= 2:
                await query.edit_message_text("الحد الأقصى قناتان.")
                return
            _waiting_channel.add(user_id)
            await query.edit_message_text(
                "أرسل يوزر القناة أو آيديها\nمثال: @MyChannel\nالبوت يجب أن يكون مشرفاً."
            )
            return
        if data == "owner_clear_force_sub":
            msg = store.clear_force_channels()
            await _save(context.bot)
            await query.edit_message_text(msg)
            return
        if data.startswith("owner_del_force_"):
            try:
                idx = int(data.rsplit("_", 1)[-1])
                ch = store.force_sub_channels[idx]
                store.remove_force_channel(ch)
                await _save(context.bot)
                await query.edit_message_text(
                    f"تم حذف {ch}",
                    reply_markup=owner_force_sub_keyboard(store.force_sub_channels),
                )
            except Exception:
                await query.edit_message_text("تعذر الحذف.")
            return
        if data == "owner_toggle_mini_app":
            # Always keep ON
            store.mini_app_enabled = True
            await _save(context.bot)
            await _force_menu_button(context.bot)
            await query.edit_message_text(
                "زر Mini-App مفعّل دائماً.\n"
                "أغلق المحادثة وافتحها من جديد إن لم يظهر الزر المربع."
            )
            return

    url = _pending_url.get(user_id)
    if data == "dl_cancel":
        _pending_url.pop(user_id, None)
        _pending_meta.pop(user_id, None)
        await query.edit_message_text("تم الإلغاء.")
        return

    mapping = {
        "dl_720": ("720", "video"),
        "dl_480": ("480", "video"),
        "dl_360": ("360", "video"),
        "dl_audio": ("best", "audio"),
        "dl_voice": ("best", "voice"),
    }
    if data not in mapping:
        return
    if not url:
        await query.edit_message_text("انتهت صلاحية الطلب. أرسل الرابط من جديد.")
        return

    quality, media_type = mapping[data]
    meta = _pending_meta.get(user_id) or {}

    cached = get_cached_file_id(url, media_type, quality)
    if cached:
        await query.edit_message_text("⚡ موجود في الأرشيف — جاري الإرسال...")
        ok, fid = await send_from_cache_or_file(
            context.bot, query.message.chat_id, cached, None, media_type, meta.get("title") or "cached"
        )
        if ok:
            store.downloads += 1
            await _maybe_publish_feed(
                user_id=user_id,
                file_id=fid or cached,
                media_type=media_type,
                title=meta.get("title") or "media",
                url=url,
                thumbnail=meta.get("thumbnail"),
                from_user=query.from_user,
            )
            await query.edit_message_text("✅ تم الإرسال من الأرشيف.")
            return

    await query.edit_message_text("⬇️ جاري التحميل... قد يستغرق حتى 3 دقائق.")
    result = await download_media(url, quality=quality, media_type=media_type)
    if not result:
        await query.edit_message_text("❌ فشل التحميل.\nجرّب جودة أقل أو رابط يوتيوب/تيك توك.")
        return

    file_id = await archive_and_get_file_id(
        context.bot,
        cfg.archive_channel_id,
        str(result.path),
        url,
        media_type,
        quality,
        result.title,
    )
    ok, sent_id = await send_from_cache_or_file(
        context.bot,
        query.message.chat_id,
        file_id,
        str(result.path),
        media_type,
        result.title,
    )
    final_id = sent_id or file_id
    if final_id:
        set_cached_file_id(url, media_type, quality, final_id)

    try:
        parent = result.path.parent
        if parent.exists() and parent.name.startswith("mediabot_"):
            shutil.rmtree(parent, ignore_errors=True)
    except Exception:
        pass

    if ok:
        store.downloads += 1
        store.touch_user(user_id)
        await _save(context.bot)
        if final_id:
            await _maybe_publish_feed(
                user_id=user_id,
                file_id=final_id,
                media_type=media_type,
                title=result.title,
                url=url,
                thumbnail=result.thumbnail or meta.get("thumbnail"),
                from_user=query.from_user,
            )
        await query.edit_message_text("✅ تم التحميل والإرسال بنجاح.")
    else:
        await query.edit_message_text("⚠️ فشل الإرسال (قد يتجاوز حد 50MB).")
    _pending_url.pop(user_id, None)
    _pending_meta.pop(user_id, None)


async def _maybe_publish_feed(
    *,
    user_id: int,
    file_id: str,
    media_type: str,
    title: str,
    url: str,
    thumbnail: str | None,
    from_user,
) -> None:
    is_owner = user_id == cfg.owner_id
    share = is_owner or store.get_share(user_id)
    if not share:
        return
    name = getattr(from_user, "first_name", None) or "مستخدم"
    try:
        await publish_feed_item(
            file_id=file_id,
            media_type=media_type,
            title=title,
            url=url,
            thumbnail=thumbnail,
            sharer_name=name,
            sharer_id=str(user_id),
        )
    except Exception as e:
        logger.warning("publish feed: %s", e)


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    err = context.error
    if isinstance(err, Conflict):
        logger.warning("Conflict (another poller) — will retry. %s", err)
        return
    if isinstance(err, (NetworkError, TimedOut)):
        logger.warning("Network issue: %s", err)
        return
    logger.exception("Unhandled error: %s", err)


async def _post_init(app: Application) -> None:
    for attempt in range(3):
        try:
            await app.bot.delete_webhook(drop_pending_updates=True)
            logger.info("delete_webhook ok (attempt %s)", attempt + 1)
            break
        except Exception as e:
            logger.warning("delete_webhook attempt %s: %s", attempt + 1, e)
            await asyncio.sleep(2)
    await asyncio.sleep(3)
    store.mini_app_enabled = True
    await _force_menu_button(app.bot)
    logger.info("Bot ready. Owner=%s Mini-App menu forced ON", cfg.owner_id)


def main() -> None:
    _start_health_server()
    app = (
        Application.builder()
        .token(cfg.bot_token)
        .post_init(_post_init)
        .connect_timeout(30.0)
        .read_timeout(30.0)
        .write_timeout(30.0)
        .pool_timeout(30.0)
        .build()
    )
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(callbacks))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, owner_text_handler), group=0)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, user_text_handler), group=1)
    app.add_error_handler(error_handler)
    logger.info("Media bot starting. Owner ID: %s", cfg.owner_id)
    app.run_polling(
        allowed_updates=Update.ALL_TYPES,
        drop_pending_updates=True,
        close_loop=False,
        poll_interval=1.0,
        timeout=25,
        bootstrap_retries=5,
    )


if __name__ == "__main__":
    main()
