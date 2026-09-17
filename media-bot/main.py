"""
Media Download Bot — entry point.
Renders the correct panel (Owner vs User) based on Telegram user id.
"""

import logging
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
from keyboards import owner_main_keyboard, user_main_keyboard

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

cfg = Config.from_env()


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    user = update.effective_user
    if not user:
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
    else:
        # TODO: check force-sub here
        await update.message.reply_text(
            "مرحباً 👋\nأرسل رابط فيديو أو صوت من يوتيوب / تيك توك / إنستغرام...\n"
            "أو استخدم الأزرار بالأسفل.",
            reply_markup=user_main_keyboard(),
        )


async def owner_text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Simple text router for owner panel buttons (Phase 1 skeleton)."""
    if not update.effective_user or update.effective_user.id != cfg.owner_id:
        return

    text = (update.message.text or "").strip()

    if text == "📊 إحصائيات":
        await update.message.reply_text("📊 الإحصائيات ستكون متاحة بعد تفعيل التحميل الفعلي.")
    elif text == "📢 قناة الاشتراك الإجباري":
        current = cfg.force_sub_channel or "غير محددة"
        await update.message.reply_text(
            f"القناة الحالية: `{current}`\n\n"
            "يمكنك تغييرها لاحقاً من هنا أو عبر متغير FORCE_SUB_CHANNEL.",
            parse_mode="Markdown",
        )
    elif text == "🌐 الموجز العام":
        status = "مفعّل ✅" if cfg.enable_global_feed else "متوقف 🔴"
        await update.message.reply_text(
            f"حالة الموجز العام (مفتاح المالك): {status}\n\n"
            "حتى لو كان مفعّلاً، كل مستخدم يقرر من إعداداته هل محتواه يظهر أم لا."
        )
    elif text == "⚙️ إعدادات البوت":
        await update.message.reply_text("إعدادات البوت العامة — قريباً.")
    elif text == "👥 إدارة المستخدمين":
        await update.message.reply_text("إدارة المستخدمين — قريباً.")
    elif text == "💎 الميزات المدفوعة":
        await update.message.reply_text(
            "بنية الميزات المدفوعة جاهزة.\n"
            "يمكن تفعيل أي ميزة لاحقاً بضغطة واحدة دون إعادة كتابة الكود."
        )
    elif text == "🔙 رجوع للقائمة الرئيسية":
        await update.message.reply_text("لوحة المالك:", reply_markup=owner_main_keyboard())
    else:
        await update.message.reply_text("استخدم الأزرار في لوحة المالك.")


async def user_text_handler(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.effective_user or update.effective_user.id == cfg.owner_id:
        return

    text = (update.message.text or "").strip()

    if text == "📥 تحميل وسائط":
        await update.message.reply_text("أرسل الرابط مباشرة وسأعرض لك خيارات الجودة.")
    elif text == "⚙️ إعداداتي":
        # Placeholder — real share_to_feed will come from user settings store
        await update.message.reply_text(
            "إعدادات الخصوصية:\n"
            "هل تريد أن يظهر المحتوى الذي تحمّله في الموجز العام؟\n"
            "(سيتم ربط الزر لاحقاً)"
        )
    elif text == "❓ مساعدة":
        await update.message.reply_text(
            "أرسل أي رابط من يوتيوب أو تيك توك أو إنستغرام...\n"
            "سأعطيك خيارات الجودة والصوت."
        )
    else:
        # Treat as potential URL — Phase 1 will call the downloader
        if text.startswith("http"):
            await update.message.reply_text(
                "تم استلام الرابط.\n"
                "محرك التحميل سيُفعّل في المرحلة التالية.\n"
                "حالياً الهيكل واللوحات جاهزة."
            )
        else:
            await update.message.reply_text("أرسل رابطاً أو استخدم الأزرار.")


def main() -> None:
    app = Application.builder().token(cfg.bot_token).build()

    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, owner_text_handler), group=0)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, user_text_handler), group=1)

    logger.info("Media bot started. Owner ID: %s", cfg.owner_id)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
