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
    "3) على يوتيوب: زر «ملخص ذكي» يعرض 3 نقاط من الترجمة قبل التحميل.\n"
    "4) الملف يُحفظ في الأرشيف ويمكن استنساخه فوراً من التطبيق المصغر.\n\n"
    "🎁 مكافأة المشاركة\n"
    "فعّل عرض تنزيلاتك في التطبيق ← حد يومي أعلى + شارة مساهم.\n\n"
    "👥 الغرف الخاصة\n"
    "• أنشئ غرفة لتحصل على رمز دعوة (مثال: 8A038B).\n"
    "• شارك الرمز مع أصدقائك → ينضمون بزر «الانضمام برمز».\n"
    "• تنزيلات أعضاء الغرفة لا تظهر في الموجز العام.\n"
    "• غرفة واحدة لكل مستخدم — لإنشاء جديدة غادر الحالية أولاً.\n\n"
    "📱 Mini-App: الزر المربع بجانب حقل الرسالة."
)


def mini_app_info() -> WebAppInfo:
    return WebAppInfo(url=MINI_APP_URL)


def menu_button_webapp() -> MenuButtonWebApp:
    return MenuButtonWebApp(text="Mini-App", web_app=mini_app_info())


def menu_button_default() -> MenuButtonDefault:
    return MenuButtonDefault()


def owner_main_keyboard() -> ReplyKeyboardMarkup:
    keyboard = [
        [KeyboardButton("📊 إحصائيات"), KeyboardButton("📢 قنوات الاشتراك")],
        [KeyboardButton("⚙️ إعدادات البوت"), KeyboardButton("👥 إدارة المستخدمين")],
        [KeyboardButton("💎 الميزات المدفوعة"), KeyboardButton("ℹ️ معلومات")],
    ]
    return ReplyKeyboardMarkup(keyboard, resize_keyboard=True)


def user_main_keyboard(mini_app_enabled: bool = True) -> ReplyKeyboardMarkup:
    keyboard = [
        [KeyboardButton("📥 تحميل وسائط")],
        [KeyboardButton("👥 غرفتي"), KeyboardButton("⚙️ إعداداتي")],
        [KeyboardButton("ℹ️ معلومات")],
    ]
    return ReplyKeyboardMarkup(keyboard, resize_keyboard=True)


def user_settings_keyboard(share_to_feed: bool) -> InlineKeyboardMarkup:
    if share_to_feed:
        label = "🔴 إيقاف عرض تنزيلاتي في التطبيق"
        perk = "✅ المكافأة نشطة: حد يومي مرتفع + شارة مساهم"
    else:
        label = "🟢 تشغيل عرض تنزيلاتي في التطبيق"
        perk = "🎁 فعّل المشاركة لرفع الحد اليومي"
    keyboard = [
        [InlineKeyboardButton(label, callback_data="toggle_share_feed")],
        [InlineKeyboardButton(perk, callback_data="perk_info")],
        [InlineKeyboardButton("🔙 إغلاق", callback_data="close_msg")],
    ]
    return InlineKeyboardMarkup(keyboard)


def squad_keyboard(has_squad: bool, code: str | None = None, members: int = 0) -> InlineKeyboardMarkup:
    """When already in a room: no create button — show status + leave/join only."""
    rows: list[list[InlineKeyboardButton]] = []
    if has_squad and code:
        rows.append(
            [InlineKeyboardButton(f"✅ غرفتك: {code} · {members} أعضاء", callback_data="squad_info")]
        )
        rows.append([InlineKeyboardButton("📋 نسخ الرمز / شرح", callback_data="squad_info")])
        rows.append([InlineKeyboardButton("🚪 مغادرة الغرفة", callback_data="squad_leave")])
        rows.append([InlineKeyboardButton("🔑 الانضمام لغرفة أخرى", callback_data="squad_join")])
    else:
        rows.append([InlineKeyboardButton("➕ إنشاء غرفة", callback_data="squad_create")])
        rows.append([InlineKeyboardButton("🔑 الانضمام برمز", callback_data="squad_join")])
    rows.append([InlineKeyboardButton("🔙 إغلاق", callback_data="close_msg")])
    return InlineKeyboardMarkup(rows)


def owner_force_sub_keyboard(channels: list[str]) -> InlineKeyboardMarkup:
    rows = [[InlineKeyboardButton("➕ إضافة قناة", callback_data="owner_add_force_sub")]]
    for i, ch in enumerate(channels):
        rows.append([InlineKeyboardButton(f"🗑 حذف {ch}", callback_data=f"owner_del_force_{i}")])
    if channels:
        rows.append([InlineKeyboardButton("🗑 حذف الكل", callback_data="owner_clear_force_sub")])
    rows.append([InlineKeyboardButton("🔙 إغلاق", callback_data="close_msg")])
    return InlineKeyboardMarkup(rows)


def quality_keyboard(show_summary: bool = False) -> InlineKeyboardMarkup:
    rows = [
        [
            InlineKeyboardButton("🎬 720p", callback_data="dl_720"),
            InlineKeyboardButton("🎬 480p", callback_data="dl_480"),
            InlineKeyboardButton("🎬 360p", callback_data="dl_360"),
        ],
        [
            InlineKeyboardButton("🎵 صوت MP3", callback_data="dl_audio"),
            InlineKeyboardButton("🎙 رسالة صوتية", callback_data="dl_voice"),
        ],
    ]
    if show_summary:
        rows.append([InlineKeyboardButton("🧠 ملخص ذكي من الترجمة", callback_data="dl_summary")])
    rows.append([InlineKeyboardButton("❌ إلغاء", callback_data="dl_cancel")])
    return InlineKeyboardMarkup(rows)
