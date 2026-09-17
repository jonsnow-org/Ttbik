"""Telegram keyboards — Owner Panel vs User Panel."""

from telegram import (
    ReplyKeyboardMarkup,
    KeyboardButton,
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    WebAppInfo,
    MenuButtonWebApp,
    MenuButtonDefault,
)

MINI_APP_URL = "https://ttbik.vercel.app/mini-app"


def mini_app_info() -> WebAppInfo:
    return WebAppInfo(url=MINI_APP_URL)


def menu_button_webapp() -> MenuButtonWebApp:
    return MenuButtonWebApp(text="Open", web_app=mini_app_info())


def menu_button_default() -> MenuButtonDefault:
    return MenuButtonDefault()


def owner_main_keyboard() -> ReplyKeyboardMarkup:
    keyboard = [
        [KeyboardButton("📊 إحصائيات"), KeyboardButton("📢 قنوات الاشتراك")],
        [KeyboardButton("📱 التطبيق المصغر"), KeyboardButton("⚙️ إعدادات البوت")],
        [KeyboardButton("👥 إدارة المستخدمين"), KeyboardButton("💎 الميزات المدفوعة")],
        [KeyboardButton("📥 تجربة التحميل")],
    ]
    return ReplyKeyboardMarkup(keyboard, resize_keyboard=True)


def user_main_keyboard(mini_app_enabled: bool = False) -> ReplyKeyboardMarkup:
    row2 = [KeyboardButton("⚙️ إعداداتي"), KeyboardButton("❓ مساعدة")]
    keyboard = [[KeyboardButton("📥 تحميل وسائط")], row2]
    return ReplyKeyboardMarkup(keyboard, resize_keyboard=True)


def user_settings_keyboard(share_to_feed: bool) -> InlineKeyboardMarkup:
    label = "✅ السماح بعرض تنزيلاتي في التطبيق" if share_to_feed else "🚫 إخفاء تنزيلاتي عن التطبيق"
    keyboard = [
        [InlineKeyboardButton(label, callback_data="toggle_share_feed")],
        [InlineKeyboardButton("🔙 إغلاق", callback_data="close_msg")],
    ]
    return InlineKeyboardMarkup(keyboard)


def owner_force_sub_keyboard(channels: list[str]) -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton("➕ إضافة قناة", callback_data="owner_add_force_sub")],
    ]
    for i, ch in enumerate(channels):
        rows.append([InlineKeyboardButton(f"🗑 حذف {ch}", callback_data=f"owner_del_force_{i}")])
    if channels:
        rows.append([InlineKeyboardButton("🗑 حذف الكل", callback_data="owner_clear_force_sub")])
    rows.append([InlineKeyboardButton("🔙 إغلاق", callback_data="close_msg")])
    return InlineKeyboardMarkup(rows)


def owner_mini_app_keyboard(enabled: bool) -> InlineKeyboardMarkup:
    label = "🔴 إيقاف زر Open" if enabled else "🟢 تفعيل زر Open داخل تيليجرام"
    rows = [[InlineKeyboardButton(label, callback_data="owner_toggle_mini_app")]]
    if enabled:
        rows.append([InlineKeyboardButton("تجربة التطبيق المصغر", web_app=mini_app_info())])
    rows.append([InlineKeyboardButton("🔙 إغلاق", callback_data="close_msg")])
    return InlineKeyboardMarkup(rows)


def quality_keyboard() -> InlineKeyboardMarkup:
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
