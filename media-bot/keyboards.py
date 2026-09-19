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
    "🎁 المشاركة (اختر وضعاً)\n"
    "• موجز عام: يظهر للجميع في رائج/فيديو/صوت\n"
    "• غرفة خاصة: يظهر لأعضاء غرفتك فقط\n"
    "• إيقاف: لا يُنشر في التطبيق\n"
    "تفعيل أي وضع مشاركة يرفع الحد اليومي.\n\n"
    "👥 الغرف الخاصة\n"
    "أنشئ غرفة → يُفعَّل نشر الغرفة تلقائياً.\n"
    "شارك الرمز مع أصدقائك.\n\n"
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


def user_main_keyboard() -> ReplyKeyboardMarkup:
    keyboard = [
        [KeyboardButton("📥 تحميل وسائط")],
        [KeyboardButton("👥 غرفتي"), KeyboardButton("⚙️ إعداداتي")],
        [KeyboardButton("ℹ️ معلومات")],
    ]
    return ReplyKeyboardMarkup(keyboard, resize_keyboard=True)


def user_settings_keyboard(
    share_public: bool,
    share_room: bool,
    has_squad: bool = False,
) -> InlineKeyboardMarkup:
    """Three-way share control: public feed / private room / off."""
    pub_label = "🔴 إيقاف الموجز العام" if share_public else "🟢 تفعيل الموجز العام"
    rows = [[InlineKeyboardButton(pub_label, callback_data="share_public_toggle")]]
    if has_squad:
        room_label = "🔴 إيقاف نشر الغرفة" if share_room else "🏠 تفعيل نشر الغرفة"
        rows.append([InlineKeyboardButton(room_label, callback_data="share_room_toggle")])
    else:
        rows.append(
            [InlineKeyboardButton("🏠 أنشئ غرفة أولاً لنشر خاص", callback_data="squad_create")]
        )
    if share_public or share_room:
        rows.append([InlineKeyboardButton("⏹ إيقاف كل النشر", callback_data="share_off")])
    rows.append([InlineKeyboardButton("🎁 عن المكافأة والحدود", callback_data="perk_info")])
    rows.append([InlineKeyboardButton("🔙 إغلاق", callback_data="close_msg")])
    return InlineKeyboardMarkup(rows)


def squad_keyboard(has_squad: bool, code: str | None = None, members: int = 0) -> InlineKeyboardMarkup:
    rows: list[list[InlineKeyboardButton]] = []
    if has_squad and code:
        rows.append(
            [InlineKeyboardButton(f"✅ غرفتك: {code} · {members} أعضاء", callback_data="squad_info")]
        )
        rows.append([InlineKeyboardButton("🏠 إعداد نشر الغرفة", callback_data="share_room_toggle")])
        rows.append([InlineKeyboardButton("📋 شرح الغرفة", callback_data="squad_info")])
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
