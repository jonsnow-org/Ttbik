"""Media Download Bot — perks, summary, squads, clone, Mini App feed."""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

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
from services.downloader import extract_info, download_media, normalize_url, EXTRACT_TIMEOUT
from services.archive import (
    get_cached_file_id,
    archive_and_get_file_id,
    send_from_cache_or_file,
    set_cached_file_id,
)
from services.store import store, persist, load_from_archive
from services.feed import publish_feed_item, find_local, increment_clone
from services.subtitles import youtube_subtitle_summary, guess_tags

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
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
    try:
        await bot.set_chat_menu_button(menu_button=menu_button_webapp())
    except Exception as e:
        logger.warning("set_chat_menu_button failed: %s", e)


async def _cold_start_notice(update: Update) -> None:
    now = time.time()
    if now - store.last_wakeup > 12 * 60:
        if update.message:
            await update.message.reply_text(
                "⏳ محرك البوت يستيقظ من وضع التوفير...\nثوانٍ معدودة ويجهز طلبك 🚀"
            )
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

    perk = store.perk_label(user.id)
    await update.message.reply_text(f"مرحباً 👋\nأرسل رابط يوتيوب / تيك توك / إنستغرام...\n\n{perk}", reply_markup=user_main_keyboard(True))


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
        n = len(store.known_users)
        await update.message.reply_text(f"📊 إحصائيات البوت\n\n• المستخدمون: {n}\n• التحميلات: {store.downloads}\n• قنوات الاشتراك: {len(store.force_sub_channels)}\n• الغرف الخاصة: {len(store.squads)}")
    elif text in ("📢 قنوات الاشتراك", "📢 قناة الاشتراك الإجباري"):
        current = "\n".join(store.force_sub_channels) if store.force_sub_channels else "لا توجد قنوات"
        await update.message.reply_text(f"قنوات الاشتراك الإجباري:\n{current}\n\nحتى قناتين.", reply_markup=owner_force_sub_keyboard(store.force_sub_channels))
    elif text == "⚙️ إعدادات البوت":
        chans = ", ".join(store.force_sub_channels) or "لا"
        await update.message.reply_text(f"• الأرشيف: {cfg.archive_channel_id or 'غير محددة'}\n• الاشتراك: {chans}\n• Mini-App: مفعّل\n• نشر المالك في الرائج: دائماً\n• yt-dlp: {_yt_dlp_version()}")
    elif text == "👥 إدارة المستخدمين":
        await update.message.reply_text(f"عدد المستخدمين: {len(store.known_users)}")
    elif text == "💎 الميزات المدفوعة":
        await update.message.reply_text("بنية جاهزة:\n• حدود يومية أعلى\n• أولوية سرعة\n• غرف خاصة\nالتفعيل لاحقاً.")
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
        share = store.get_share(user.id)
        await update.message.reply_text(f"إعداداتك:\n{store.perk_label(user.id)}\nاليوم: {store.daily_count(user.id)}/{store.daily_limit(user.id)}", reply_markup=user_settings_keyboard(share))
    elif text == "👥 غرفتي":
        code = store.get_user_squad(user.id)
        if code:
            sq = store.squads.get(code) or {}
            members = len(sq.get("members") or [])
            body = (
                f"👥 الغرف الخاصة\n\n"
                f"✅ أنت داخل الغرفة: `{code}`\n"
                f"👥 الأعضاء: {members}\n\n"
                f"كيف تعمل؟\n"
                f"• شارك الرمز `{code}` مع أصدقائك\n"
                f"• ينضمون عبر «الانضمام برمز»\n"
                f"• تنزيلاتكم لا تظهر في الموجز العام\n"
                f"• لإنشاء غرفة جديدة: غادر الحالية أولاً"
            )
        else:
            body = (
                "👥 الغرف الخاصة\n\n"
                "لست في غرفة حالياً.\n\n"
                "• «إنشاء غرفة» → تحصل على رمز دعوة\n"
                "• «الانضمام برمز» → أدخل رمز صديقك\n"
                "• تنزيلات الغرفة لا تظهر للعامة"
            )
        await update.message.reply_text(body, parse_mode="Markdown", reply_markup=_squad_kb(user.id))
    elif text in ("ℹ️ معلومات", "❓ مساعدة"):
        await update.message.reply_text(INFO_TEXT)
    elif text.startswith("http"):
        await _handle_url(update, context, text)
    else:
        await update.message.reply_text("أرسل رابطاً أو استخدم الأزرار.", reply_markup=user_main_keyboard(True))


async def _handle_url(update: Update, context: ContextTypes.DEFAULT_TYPE, url: str) -> None:
    user = update.effective_user
    if not user or not update.message:
        return
    store.touch_user(user.id)
    is_owner = user.id == cfg.owner_id
    if is_owner:
        store.set_share(user.id, True)
    allowed, limit_msg = store.can_download(user.id, is_owner)
    if not allowed:
        await update.message.reply_text(limit_msg)
        return
    status_msg = await update.message.reply_text("⏳ جاري جلب معلومات الرابط...")
    err = ""
    try:
        info, err = await asyncio.wait_for(extract_info(url), timeout=EXTRACT_TIMEOUT + 15)
    except asyncio.TimeoutError:
        info, err = None, "timeout: extract_info exceeded its outer bound"
    except Exception as e:
        info, err = None, f"{type(e).__name__}: {e}"
    if not info:
        detail = f"\n\n🔧 {err[:200]}" if err and is_owner else ""
        await status_msg.edit_text("❌ تعذر قراءة الرابط.\nجرّب رابطاً مباشراً من يوتيوب / تيك توك / إنستغرام." + detail)
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
        await query.edit_message_text("🎁 نظام التحفيز:\n• بدون مشاركة: حد يومي أساسي\n• مع المشاركة: حد أعلى + شارة مساهم\n• الاستنساخ من الرائج فوري", reply_markup=user_settings_keyboard(store.get_share(user_id)))
        return
    if data == "check_sub":
        ok = await require_subscription(context.bot, user_id, store.force_sub_channels, query.message.chat_id)
        if ok:
            await query.edit_message_text("✅ تم التحقق. أرسل الرابط الآن.")
        return
    if data == "toggle_share_feed":
        new_val = not store.get_share(user_id)
        store.set_share(user_id, new_val)
        await _save(context.bot)
        note = f"✅ المشاركة مفعّلة\n{store.perk_label(user_id)}" if new_val else "تم إيقاف المشاركة — الحد اليومي عاد للأساسي."
        await query.edit_message_text(note, reply_markup=user_settings_keyboard(new_val))
        return

    if data == "squad_create":
        if store.get_user_squad(user_id):
            await query.edit_message_text("أنت بالفعل في غرفة.\nغادرها أولاً ثم أنشئ غرفة جديدة.", reply_markup=_squad_kb(user_id))
            return
        code = store.create_squad(user_id)
        await _save(context.bot)
        await query.edit_message_text(
            f"✅ تم إنشاء غرفتك\n\nرمز الدعوة: `{code}`\n\nشارك هذا الرمز مع أصدقائك ليكتبوه بعد «الانضمام برمز».\nتنزيلات الغرفة لا تظهر في الموجز العام.",
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
        await query.edit_message_text(
            f"📋 غرفتك `{code}`\n👥 {members} أعضاء\n\nأرسل الرمز `{code}` لأي صديق لينضم.\nالتنزيلات داخل الغرفة خاصة بكم فقط.",
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
        await query.edit_message_text(f"{msg}\n\nيمكنك الآن إنشاء غرفة جديدة أو الانضمام لرمز آخر.", reply_markup=_squad_kb(user_id))
        return

    if is_owner:
        if data == "owner_add_force_sub":
            if len(store.force_sub_channels) >= 2:
                await query.edit_message_text("الحد الأقصى قناتان.")
                return
            _waiting_channel.add(user_id)
            await query.edit_message_text("أرسل يوزر القناة أو آيديها. البوت يجب أن يكون مشرفاً.")
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
            await query.edit_message_text("تعذر جلب ترجمة.\nيمكنك التحميل مباشرة.", reply_markup=quality_keyboard(show_summary=False))
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
        await query.edit_message_text("انتهت صلاحية الطلب. أرسل الرابط من جديد.")
        return

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
    if not store.get_share(user_id) and user_id != cfg.owner_id:
        return
    squad = store.get_user_squad(user_id)
    name = getattr(from_user, "first_name", None) or "مستخدم"
    tags = guess_tags(title, "")
    try:
        await publish_feed_item(
            file_id=file_id, media_type=media_type, title=title, url=url or "",
            thumbnail=thumbnail or "", sharer_name=name, sharer_id=str(user_id),
            tags=tags, squad_code=squad or "",
        )
    except Exception as e:
        logger.warning("publish_feed_item failed: %s", e)


async def version_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message:
        await update.message.reply_text(f"yt-dlp: {_yt_dlp_version()}")


def main() -> None:
    _start_health_server()
    app = Application.builder().token(cfg.bot_token).build()

    async def _post_init(application: Application) -> None:
        await load_from_archive(application.bot, cfg.archive_channel_id)
        await _force_menu_button(application.bot)

    app.post_init = _post_init
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("version", version_cmd))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, pending_message_relay_handler), group=-1)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, owner_text_handler))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, user_text_handler))
    app.add_handler(CallbackQueryHandler(callbacks))

    logger.info("Bot starting (polling)...")
    app.run_polling(drop_pending_updates=True, allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
