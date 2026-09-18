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

INFO_TEXT = (
    "ℹ️ طريقة الاستخدام\n\n"
    "1) أرسل رابط يوتيوب / تيك توك / إنستغرام / تويتر.\n"
    "2) اختر الجودة أو الصوت أو الرسالة الصوتية.\n"
    "3) الملف يُرسل لك في المحادثة ويُحفظ في قناة الأرشيف.\n\n"
    "📱 التطبيق المصغر (Mini-App)\n"
    "الزر المربع بجانب حقل الرسالة (يسار) يفتح التطبيق داخل تيليجرام.\n"
    "يعرض الرائج والأحدث وملفك الشخصي وتنزيلاتك المنشورة.\n\n"
    "⚙️ الخصوصية\n"
    "من إعداداتي تقدر تمنع ظهور تنزيلاتك في التطبيق."
)


def mini_app_info() -> WebAppInfo:
    return WebAppInfo(url=MINI_APP_URL)


def menu_button_webapp() -> MenuButtonWebApp:
    return MenuButtonWebApp(text="Mini-App", web_app=mini_app_info())


def menu_button_default() -> MenuButtonDefault:
    return MenuButtonDefault()


def owner_main_keyboard() -> ReplyKeyboardMarkup:
    # بدون «التطبيق المصغر» و«تجربة التحميل» — التحميل بإرسال الرابط مباشرة
    keyboard = [
        [KeyboardButton("📊 إحصائيات"), KeyboardButton("📢 قنوات الاشتراك")],
        [KeyboardButton("⚙️ إعدادات البوت"), KeyboardButton("👥 إدارة المستخدمين")],
        [KeyboardButton("💎 الميزات المدفوعة"), KeyboardButton("ℹ️ معلومات")],
    ]
    return ReplyKeyboardMarkup(keyboard, resize_keyboard=True)


def user_main_keyboard(mini_app_enabled: bool = True) -> ReplyKeyboardMarkup:
    keyboard = [
        [KeyboardButton("📥 تحميل وسائط")],
        [KeyboardButton("⚙️ إعداداتي"), KeyboardButton("ℹ️ معلومات")],
    ]
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
    # بقي للتوافق إن استُدعي من كود قديم — الزر الأساسي هو Menu Button
    label = "🔴 إيقاف زر Mini-App" if enabled else "🟢 تفعيل زر Mini-App أسفل الشات"
    rows = [[InlineKeyboardButton(label, callback_data="owner_toggle_mini_app")]]
    if enabled:
        rows.append([InlineKeyboardButton("فتح التطبيق المصغر", web_app=mini_app_info())])
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
