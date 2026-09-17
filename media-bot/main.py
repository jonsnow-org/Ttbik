"""Media Download Bot — owner panel, user panel, downloads, native Mini App."""

from __future__ import annotations

import logging
import os
import shutil
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from telegram import Update, InlineKeyboardMarkup, InlineKeyboardButton
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
    owner_mini_app_keyboard,
    user_settings_keyboard,
    menu_button_webapp,
    menu_button_default,
    mini_app_info,
)
from services.force_sub import require_subscription
from services.downloader import extract_info, download_media
from services.archive import (
    get_cached_file_id,
    archive_and_get_file_id,
    send_from_cache_or_file,
)
from services.store import store, persist

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

cfg = Config.from_env()
_pending_url: dict[int, str] = {}
_waiting_channel: set[int] = set()

if cfg.force_sub_channel and not store.force_sub_channels:
    store.force_sub_channels = [cfg.force_sub_channel]
store.mini_app_enabled = store.mini_app_enabled or cfg.enable_global_feed


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


async def _sync_menu_button(bot) -> None:
    try:
        if store.mini_app_enabled:
            await bot.set_chat_menu_button(menu_button=menu_button_webapp())
        else:
            await bot.set_chat_menu_button(menu_button=menu_button_default())
    except Exception as e:
        logger.warning("set_chat_menu_button failed: %s", e)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not user or not update.message:
        return
    store.touch_user(user.id)
    await _sync_menu_button(context.bot)

    if user.id == cfg.owner_id:
        await update.message.reply_text(
            "👑 لوحة مالك البوت\n\n"
            "من هنا تضبط قنوات الاشتراك، زر Open للتطبيق المصغر، والإحصائيات.",
            reply_markup=owner_main_keyboard(),
        )
        return

    ok = await require_subscription(
        context.bot, user.id, store.force_sub_channels, update.effective_chat.id
    )
    if not ok:
        return

    await update.message.reply_text(
        "مرحباً 👋\nأرسل رابط فيديو أو صوت من يوتيوب / تيك توك / إنستغرام...",
        reply_markup=user_main_keyboard(store.mini_app_enabled),
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
            f"• زر Open / التطبيق المصغر: {'مفعّل' if store.mini_app_enabled else 'متوقف'}"
        )
    elif text in ("📢 قنوات الاشتراك", "📢 قناة الاشتراك الإجباري"):
        current = "\n".join(store.force_sub_channels) if store.force_sub_channels else "لا توجد قنوات"
        await update.message.reply_text(
            f"قنوات الاشتراك الإجباري الحالية:\n{current}\n\n"
            "يمكنك إضافة حتى قناتين، أو حذف أي قناة من الأزرار.",
            reply_markup=owner_force_sub_keyboard(store.force_sub_channels),
        )
    elif text in ("📱 التطبيق المصغر", "🌐 الموجز العام"):
        await update.message.reply_text(
            "📱 التطبيق المصغر داخل تيليجرام\n\n"
            "عند تفعيله يظهر زر Open أسفل المحادثة (يسار حقل الرسالة) مثل بوتات التيك توك.\n"
            "يفتح واجهة داخل تيليجرام: الرئيسية + الأحدث.\n"
            "يظهر فقط ما سمح المستخدم بنشره من تنزيلاته.\n\n"
            f"الحالة الآن: {'مفعّل ✅' if store.mini_app_enabled else 'متوقف 🔴'}",
            reply_markup=owner_mini_app_keyboard(store.mini_app_enabled),
        )
    elif text == "⚙️ إعدادات البوت":
        chans = ", ".join(store.force_sub_channels) or "لا"
        await update.message.reply_text(
            f"• قناة الأرشيف: {cfg.archive_channel_id or 'غير محددة'}\n"
            f"• الاشتراك الإجباري: {chans}\n"
            f"• زر Open: {'مفعّل' if store.mini_app_enabled else 'متوقف'}"
        )
    elif text == "👥 إدارة المستخدمين":
        await update.message.reply_text(
            f"عدد المستخدمين: {len(store.known_users)}\n"
            "الحظر التفصيلي سيُضاف في التحديث التالي."
        )
    elif text == "💎 الميزات المدفوعة":
        await update.message.reply_text(
            "بنية الميزات المدفوعة جاهزة ويمكن تفعيل أي ميزة لاحقاً بضغطة."
        )
    elif text in ("📥 تجربة التحميل", "🔙 رجوع للقائمة الرئيسية"):
        await update.message.reply_text("لوحة المالك:", reply_markup=owner_main_keyboard())
    elif text.startswith("http"):
        await _handle_url(update, context, text)
    else:
        await update.message.reply_text("استخدم أزرار لوحة المالك.", reply_markup=owner_main_keyboard())


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
            "إعدادات الخصوصية:\n"
            "إذا فعّلت السماح، ما تنزّله يمكن أن يظهر في التطبيق المصغر داخل تيليجرام.\n"
            "إذا أوقفتها، محتواك يبقى خاصاً بك فقط.",
            reply_markup=user_settings_keyboard(share),
        )
    elif text == "📱 فتح التطبيق المصغر":
        if not store.mini_app_enabled:
            await update.message.reply_text("التطبيق المصغر غير مفعّل حالياً.")
            return
        await update.message.reply_text(
            "افتح التطبيق المصغر من زر Open أسفل المحادثة، أو من الزر التالي:",
            reply_markup=InlineKeyboardMarkup(
                [[InlineKeyboardButton("📱 فتح داخل تيليجرام", web_app=mini_app_info())]]
            ),
        )
    elif text == "❓ مساعدة":
        await update.message.reply_text(
            "أرسل أي رابط من يوتيوب أو تيك توك أو إنستغرام أو تويتر...\n"
            "سأعطيك خيارات الجودة والصوت والرسالة الصوتية."
        )
    elif text.startswith("http"):
        await _handle_url(update, context, text)
    else:
        await update.message.reply_text(
            "أرسل رابطاً أو استخدم الأزرار.",
            reply_markup=user_main_keyboard(store.mini_app_enabled),
        )


async def _handle_url(update: Update, context: ContextTypes.DEFAULT_TYPE, url: str) -> None:
    user = update.effective_user
    if not user or not update.message:
        return
    store.touch_user(user.id)

    status_msg = await update.message.reply_text("⏳ جاري جلب معلومات الرابط...")
    info = await extract_info(url)
    if not info:
        await status_msg.edit_text("❌ تعذر قراءة الرابط. تأكد أنه صحيح ومدعوم.")
        return

    _pending_url[user.id] = url
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
        await query.edit_message_reply_markup(reply_markup=user_settings_keyboard(new_val))
        return

    if user_id == cfg.owner_id:
        if data == "owner_add_force_sub":
            if len(store.force_sub_channels) >= 2:
                await query.edit_message_text("الحد الأقصى قناتان. احذف واحدة أولاً.")
                return
            _waiting_channel.add(user_id)
            await query.edit_message_text(
                "أرسل الآن يوزر القناة أو آيديها\nمثال: @MyChannel أو -1001234567890\n\n"
                "تأكد أن البوت مشرف في القناة."
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
            store.mini_app_enabled = not store.mini_app_enabled
            await _save(context.bot)
            await _sync_menu_button(context.bot)
            await query.edit_message_text(
                "تم تفعيل زر Open أسفل المحادثة. أغلق المحادثة وافتحها من جديد إن لم يظهر."
                if store.mini_app_enabled
                else "تم إيقاف زر Open.",
                reply_markup=owner_mini_app_keyboard(store.mini_app_enabled),
            )
            return

    url = _pending_url.get(user_id)
    if data == "dl_cancel":
        _pending_url.pop(user_id, None)
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
    cached = get_cached_file_id(url, media_type, quality)
    if cached:
        await query.edit_message_text("⚡ موجود في الأرشيف — جاري الإرسال...")
        ok = await send_from_cache_or_file(
            context.bot, query.message.chat_id, cached, None, media_type, "cached"
        )
        if ok:
            store.downloads += 1
            await query.edit_message_text("✅ تم الإرسال من الأرشيف.")
            return

    await query.edit_message_text("⬇️ جاري التحميل... قد يستغرق بعض الوقت.")
    result = await download_media(url, quality=quality, media_type=media_type)
    if not result:
        await query.edit_message_text("❌ فشل التحميل. جرّب جودة أقل أو رابطاً آخر.")
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
    ok = await send_from_cache_or_file(
        context.bot,
        query.message.chat_id,
        file_id,
        str(result.path),
        media_type,
        result.title,
    )
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
        await query.edit_message_text("✅ تم التحميل والإرسال بنجاح.")
    else:
        await query.edit_message_text("⚠️ تم التحميل لكن فشل الإرسال. حاول مرة أخرى.")
    _pending_url.pop(user_id, None)


async def _post_init(app: Application) -> None:
    await _sync_menu_button(app.bot)


def main() -> None:
    _start_health_server()
    app = Application.builder().token(cfg.bot_token).post_init(_post_init).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(callbacks))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, owner_text_handler), group=0)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, user_text_handler), group=1)
    logger.info("Media bot started. Owner ID: %s", cfg.owner_id)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
