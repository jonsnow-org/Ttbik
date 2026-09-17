"""
Telegram keyboards for the Media Download Bot.
Two completely separate panels:
- Owner Panel  → only for OWNER_ID
- User Panel   → for everyone else
"""

from telegram import ReplyKeyboardMarkup, KeyboardButton, InlineKeyboardMarkup, InlineKeyboardButton


def owner_main_keyboard() -> ReplyKeyboardMarkup:
    """Main control panel shown only to the bot owner."""
    keyboard = [
        [KeyboardButton("📊 إحصائيات"), KeyboardButton("📢 قناة الاشتراك الإجباري")],
        [KeyboardButton("🌐 الموجز العام"), KeyboardButton("⚙️ إعدادات البوت")],
        [KeyboardButton("👥 إدارة المستخدمين"), KeyboardButton("💎 الميزات المدفوعة")],
        [KeyboardButton("🔙 رجوع للقائمة الرئيسية")],
    ]
    return ReplyKeyboardMarkup(keyboard, resize_keyboard=True)


def user_main_keyboard() -> ReplyKeyboardMarkup:
    """Main panel for normal users."""
    keyboard = [
        [KeyboardButton("📥 تحميل وسائط")],
        [KeyboardButton("⚙️ إعداداتي"), KeyboardButton("❓ مساعدة")],
    ]
    return ReplyKeyboardMarkup(keyboard, resize_keyboard=True)


def user_settings_keyboard(share_to_feed: bool) -> InlineKeyboardMarkup:
    """User privacy settings — whether their downloads appear in the global feed."""
    label = "✅ يظهر محتواي في الموجز" if share_to_feed else "🚫 لا يظهر محتواي في الموجز"
    keyboard = [
        [InlineKeyboardButton(label, callback_data="toggle_share_feed")],
        [InlineKeyboardButton("🔙 رجوع", callback_data="back_user_main")],
    ]
    return InlineKeyboardMarkup(keyboard)


def owner_force_sub_keyboard(current: str | None) -> InlineKeyboardMarkup:
    """Owner: set / change / remove forced subscription channel."""
    keyboard = [
        [InlineKeyboardButton("➕ تعيين / تغيير القناة", callback_data="owner_set_force_sub")],
        [InlineKeyboardButton("🗑 إزالة الاشتراك الإجباري", callback_data="owner_clear_force_sub")],
        [InlineKeyboardButton("🔙 رجوع للوحة المالك", callback_data="owner_main")],
    ]
    return InlineKeyboardMarkup(keyboard)


def owner_global_feed_keyboard(enabled: bool) -> InlineKeyboardMarkup:
    """Owner master switch for the global feed feature."""
    label = "🔴 إيقاف الموجز العام" if enabled else "🟢 تفعيل الموجز العام"
    keyboard = [
        [InlineKeyboardButton(label, callback_data="owner_toggle_global_feed")],
        [InlineKeyboardButton("🔙 رجوع للوحة المالك", callback_data="owner_main")],
    ]
    return InlineKeyboardMarkup(keyboard)


def quality_keyboard() -> InlineKeyboardMarkup:
    """Shown after user sends a link."""
    keyboard = [
        [
            InlineKeyboardButton("🎬 720p", callback_data="dl_720"),
            InlineKeyboardButton("🎬 480p", callback_data="dl_480"),
            InlineKeyboardButton("🎬 360p", callback_data="dl_360"),
        ],
        [
            InlineKeyboardButton("🎵 صوت MP3", callback_data="dl_audio"),
            InlineKeyboardButton("🎙 رسالة صوتية", callback_data="dl_voice"),
        ],
        [InlineKeyboardButton("❌ إلغاء", callback_data="dl_cancel")],
    ]
    return InlineKeyboardMarkup(keyboard)
