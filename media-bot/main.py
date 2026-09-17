"""
Media Download Bot — entry point.
Owner Panel vs User Panel + real download flow with archive cache.
Includes a tiny HTTP health server so Render Web Service detects an open port.
"""

from __future__ import annotations

import logging
import os
import shutil
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from telegram import Update
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
)
from services.force_sub import require_subscription
from services.downloader import extract_info, download_media
from services.archive import (
    get_cached_file_id,
    archive_and_get_file_id,
    send_from_cache_or_file,
)

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

cfg = Config.from_env()

# Temporary store of pending URL per user (user_id -> url)
_pending_url: dict[int, str] = {}


class _HealthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, format, *args):
        return  # silence access logs


def _start_health_server() -> None:
    """Bind PORT so Render Web Service health-check succeeds."""
    port = int(os.environ.get("PORT", "10000"))
    server = HTTPServer(("0.0.0.0", port), _HealthHandler)
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    logger.info("Health server listening on port %s", port)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not user or not update.message:
        return

    if user.id == cfg.owner_id:
        await update.message.reply_text(
            "👑 مرحباً بك في لوحة مالك البوت\n\n"
            "من هنا تتحكم في:\n"
            "• قناة الاشتراك الإجباري\n"
            "• تفعيل/إيقاف الموجز العام\n"
            "• الإحصائيات وإدارة المستخدمين\n"
            "• الميزات المدفوعة لاحقاً",
            reply_markup=owner_main_keyboard(),
        )
        return

    ok = await require_subscription(
        context.bot, user.id, cfg.force_sub_channel, update.effective_chat.id
    )
    if not ok:
        return

    await update.message.reply_text(
        "مرحباً 👋\nأرسل رابط فيديو أو صوت من يوتيوب / تيك توك / إنستغرام...\n"
        "أو استخدم الأزرار بالأسفل.",
        reply_markup=user_main_keyboard(),
    )


async def owner_text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user or update.effective_user.id != cfg.owner_id:
        return
    if not update.message:
        return

    text = (update.message.text or "").strip()

    if text == "📊 إحصائيات":
        await update.message.reply_text("📊 الإحصائيات التفصيلية قادمة في التحديث التالي.")
    elif text == "📢 قناة الاشتراك الإجباري":
        current = cfg.force_sub_channel or "غير محددة"
        await update.message.reply_text(
            f"القناة الحالية: `{current}`\n\n"
            "لتغييرها عدّل متغير FORCE_SUB_CHANNEL على Render ثم أعد تشغيل الخدمة.",
            parse_mode="Markdown",
        )
    elif text == "🌐 الموجز العام":
        status = "مفعّل ✅" if cfg.enable_global_feed else "متوقف 🔴"
        await update.message.reply_text(
            f"حالة الموجز العام (مفتاح المالك): {status}\n\n"
            "حتى لو كان مفعّلاً، كل مستخدم يقرر من إعداداته هل محتواه يظهر أم لا."
        )
    elif text == "⚙️ إعدادات البوت":
        await update.message.reply_text(
            f"• قناة الأرشيف: `{cfg.archive_channel_id or 'غير محددة'}`\n"
            f"• الاشتراك الإجباري: `{cfg.force_sub_channel or 'لا'}`\n"
            f"• الموجز العام: {'مفعّل' if cfg.enable_global_feed else 'متوقف'}",
            parse_mode="Markdown",
        )
    elif text == "👥 إدارة المستخدمين":
        await update.message.reply_text("إدارة المستخدمين — قريباً.")
    elif text == "💎 الميزات المدفوعة":
        await update.message.reply_text(
            "بنية الميزات المدفوعة جاهزة.\n"
            "يمكن تفعيل أي ميزة لاحقاً بضغطة واحدة دون إعادة كتابة الكود."
        )
    elif text == "🔙 رجوع للقائمة الرئيسية":
        await update.message.reply_text("لوحة المالك:", reply_markup=owner_main_keyboard())
    elif text.startswith("http"):
        await _handle_url(update, context, text)
    else:
        await update.message.reply_text("استخدم الأزرار في لوحة المالك.")


async def user_text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user or not update.message:
        return
    if update.effective_user.id == cfg.owner_id:
        return

    user = update.effective_user
    text = (update.message.text or "").strip()

    ok = await require_subscription(
        context.bot, user.id, cfg.force_sub_channel, update.effective_chat.id
    )
    if not ok:
        return

    if text == "📥 تحميل وسائط":
        await update.message.reply_text("أرسل الرابط مباشرة وسأعرض لك خيارات الجودة.")
    elif text == "⚙️ إعداداتي":
        await update.message.reply_text(
            "إعدادات الخصوصية:\n"
            "هل تريد أن يظهر المحتوى الذي تحمّله في الموجز العام؟\n"
            "(الزر التفاعلي سيُربط بالكامل في التحديث القادم)"
        )
    elif text == "❓ مساعدة":
        await update.message.reply_text(
            "أرسل أي رابط من يوتيوب أو تيك توك أو إنستغرام أو تويتر...\n"
            "سأعطيك خيارات الجودة والصوت والرسالة الصوتية."
        )
    elif text.startswith("http"):
        await _handle_url(update, context, text)
    else:
        await update.message.reply_text("أرسل رابطاً أو استخدم الأزرار.")


async def _handle_url(update: Update, context: ContextTypes.DEFAULT_TYPE, url: str) -> None:
    user = update.effective_user
    if not user or not update.message:
        return

    status_msg = await update.message.reply_text("⏳ جاري جلب معلومات الرابط...")

    info = await extract_info(url)
    if not info:
        await status_msg.edit_text("❌ تعذر قراءة الرابط. تأكد أنه صحيح ومدعوم.")
        return

    _pending_url[user.id] = url

    duration = f"{info.duration // 60}:{info.duration % 60:02d}" if info.duration else "؟"
    text = (
        f"✅ {info.title[:80]}\n"
        f"⏱ المدة: {duration}\n"
        f"📡 المصدر: {info.extractor}\n\n"
        "اختر الجودة أو نوع التحميل:"
    )
    await status_msg.edit_text(text, reply_markup=quality_keyboard())


async def quality_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not query or not query.from_user:
        return

    await query.answer()
    data = query.data or ""
    user_id = query.from_user.id
    url = _pending_url.get(user_id)

    if data == "dl_cancel":
        _pending_url.pop(user_id, None)
        await query.edit_message_text("تم الإلغاء.")
        return

    if data == "check_sub":
        ok = await require_subscription(
            context.bot, user_id, cfg.force_sub_channel, query.message.chat_id
        )
        if ok:
            await query.edit_message_text("✅ تم التحقق. أرسل الرابط الآن.")
        return

    if not url:
        await query.edit_message_text("انتهت صلاحية الطلب. أرسل الرابط من جديد.")
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

    quality, media_type = mapping[data]

    cached = get_cached_file_id(url, media_type, quality)
    if cached:
        await query.edit_message_text("⚡ موجود في الأرشيف — جاري الإرسال...")
        ok = await send_from_cache_or_file(
            context.bot, query.message.chat_id, cached, None, media_type, "cached"
        )
        if ok:
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
        await query.edit_message_text("✅ تم التحميل والإرسال بنجاح.")
    else:
        await query.edit_message_text("⚠️ تم التحميل لكن فشل الإرسال. حاول مرة أخرى.")

    _pending_url.pop(user_id, None)


def main() -> None:
    _start_health_server()

    app = Application.builder().token(cfg.bot_token).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(quality_callback))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, owner_text_handler), group=0)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, user_text_handler), group=1)

    logger.info("Media bot started. Owner ID: %s", cfg.owner_id)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
