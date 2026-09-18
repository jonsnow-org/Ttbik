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
from services.downloader import extract_info, download_media, normalize_url
from services.archive import (
    get_cached_file_id,
    archive_and_get_file_id,
    send_from_cache_or_file,
    set_cached_file_id,
)
from services.store import store, persist
from services.feed import publish_feed_item, find_local, increment_clone
from services.subtitles import youtube_subtitle_summary, guess_tags

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

cfg = Config.from_env()
_pending_url: dict[int, str] = {}
_pending_meta: dict[int, dict] = {}
_waiting_channel: set[int] = set()
_waiting_squad_join: set[int] = set()

if cfg.force_sub_channel and not store.force_sub_channels:
    store.force_sub_channels = [cfg.force_sub_channels]
store.mini_app_enabled = True
store.set_share(cfg.owner_id, True)


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
                    r = await client.put(
                        _api_url(),
                        json={"id": item_id},
                        headers={"x-feed-secret": _secret()},
                    )
                    if r.status_code < 400:
                        item = (r.json() or {}).get("item")
            except Exception:
                item = None
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
        if ok:
            await increment_clone(item_id)
            await update.message.reply_text("⚡ تم الإرسال فوراً من الكاش (استنساخ بضغطة).")
        else:
            await update.message.reply_text("❌ تعذر الإرسال.")
        return

    if user.id == cfg.owner_id:
        store.set_share(user.id, True)
        await update.message.reply_text(
            "👑 لوحة مالك البوت\n\nأرسل أي رابط للتحميل مباشرة.\n\nاختبار كامل: /testdl رابط",
            reply_markup=owner_main_keyboard(),
        )
        return

    ok = await require_subscription(
        context.bot, user.id, store.force_sub_channels, update.effective_chat.id
    )
    if not ok:
        return

    perk = store.perk_label(user.id)
    await update.message.reply_text(
        f"مرحباً 👋\nأرسل رابط يوتيوب / تيك توك / إنستغرام...\n\n{perk}",
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
        await update.message.reply_text(msg, reply_markup=owner_force_sub_keyboard(store.force_sub_channels))
        return

    if text == "📊 إحصائيات":
        n = len(store.known_users)
        await update.message.reply_text(
            "📊 إحصائيات البوت\n\n"
            f"• المستخدمون: {n}\n"
            f"• التحميلات: {store.downloads}\n"
            f"• قنوات الاشتراك: {len(store.force_sub_channels)}\n"
            f"• الغرف الخاصة: {len(store.squads)}"
        )
    elif text in ("📢 قنوات الاشتراك", "📢 قناة الاشتراك الإجباري"):
        current = "\n".join(store.force_sub_channels) if store.force_sub_channels else "لا توجد قنوات"
        await update.message.reply_text(
            f"قنوات الاشتراك الإجباري:\n{current}\n\nحتى قناتين.",
            reply_markup=owner_force_sub_keyboard(store.force_sub_channels),
        )
    elif text == "⚙️ إعدادات البوت":
        chans = ", ".join(store.force_sub_channels) or "لا"
        await update.message.reply_text(
            f"• الأرشيف: {cfg.archive_channel_id or 'غير محددة'}\n"
            f"• الاشتراك: {chans}\n"
            "• Mini-App: مفعّل\n"
            "• نشر المالك في الرائج: دائماً"
        )
    elif text == "👥 إدارة المستخدمين":
        await update.message.reply_text(f"عدد المستخدمين: {len(store.known_users)}")
    elif text == "💎 الميزات المدفوعة":
        await update.message.reply_text(
            "بنية جاهزة:\n• حدود يومية أعلى\n• أولوية سرعة\n• غرف خاصة\nالتفعيل لاحقاً."
        )
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
        await update.message.reply_text(msg)
        return

    ok = await require_subscription(
        context.bot, user.id, store.force_sub_channels, update.effective_chat.id
    )
    if not ok:
        return

    if text == "📥 تحميل وسائط":
        await update.message.reply_text("أرسل الرابط مباشرة وسأعرض الخيارات.")
    elif text == "⚙️ إعداداتي":
        share = store.get_share(user.id)
        await update.message.reply_text(
            f"إعداداتك:\n{store.perk_label(user.id)}\n"
            f"اليوم: {store.daily_count(user.id)}/{store.daily_limit(user.id)}",
            reply_markup=user_settings_keyboard(share),
        )
    elif text == "👥 غرفتي":
        code = store.get_user_squad(user.id)
        info = f"غرفتك الحالية: {code}" if code else "لست في غرفة."
        await update.message.reply_text(
            f"👥 الغرف الخاصة\n{info}\n\nالتنزيلات داخل الغرفة لا تظهر للعامة.",
            reply_markup=squad_keyboard(bool(code)),
        )
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
        info, err = await extract_info(url)
    except Exception as e:
        info, err = None, str(e)

    if not info:
        detail = f"\n\n🔧 {err[:300]}" if err and is_owner else ""
        await status_msg.edit_text(
            "❌ تعذر قراءة الرابط.\nجرّب رابطاً مباشراً من يوتيوب / تيك توك / إنستغرام."
            + detail
        )
        return

    _pending_url[user.id] = url
    is_yt = "youtube" in (info.extractor or "").lower() or "youtu" in url.lower()
    _pending_meta[user.id] = {
        "title": info.title,
        "thumbnail": info.thumbnail,
        "extractor": info.extractor,
        "is_youtube": is_yt,
    }
    duration = f"{info.duration // 60}:{info.duration % 60:02d}" if info.duration else "؟"
    tags = guess_tags(info.title, info.extractor)
    await status_msg.edit_text(
        f"✅ {info.title[:80]}\n"
        f"⏱ {duration} · 📡 {info.extractor}\n"
        f"🏷 {' · '.join(tags)}\n"
        f"📊 {limit_msg}\n\nاختر:",
        reply_markup=quality_keyboard(show_summary=is_yt),
    )


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
        await query.edit_message_text(
            "🎁 نظام التحفيز:\n• بدون مشاركة: حد يومي أساسي\n• مع المشاركة: حد أعلى + شارة مساهم\n• الاستنساخ من الرائج فوري",
            reply_markup=user_settings_keyboard(store.get_share(user_id)),
        )
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
            f"✅ المشاركة مفعّلة\n{store.perk_label(user_id)}"
            if new_val
            else "تم إيقاف المشاركة — الحد اليومي عاد للأساسي."
        )
        await query.edit_message_text(note, reply_markup=user_settings_keyboard(new_val))
        return

    if data == "squad_create":
        code = store.create_squad(user_id)
        await _save(context.bot)
        await query.edit_message_text(
            f"✅ تم إنشاء غرفتك\nرمز الدعوة: `{code}`\nشاركه مع أصدقائك.",
            parse_mode="Markdown",
            reply_markup=squad_keyboard(True),
        )
        return
    if data == "squad_join":
        _waiting_squad_join.add(user_id)
        await query.edit_message_text("أرسل رمز الغرفة الآن (مثال: A1B2C3).")
        return
    if data == "squad_leave":
        msg = store.leave_squad(user_id)
        await _save(context.bot)
        await query.edit_message_text(msg, reply_markup=squad_keyboard(False))
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
                await query.edit_message_text(
                    f"تم حذف {ch}", reply_markup=owner_force_sub_keyboard(store.force_sub_channels)
                )
            except Exception:
                await query.edit_message_text("تعذر الحذف.")
            return

    if data == "dl_summary":
        url = _pending_url.get(user_id)
        if not url:
            await query.edit_message_text("انتهت صلاحية الطلب.")
            return
        await query.edit_message_text("🧠 جاري استخراج الترجمة وتلخيصها...")
        points, lang = await youtube_subtitle_summary(normalize_url(url))
        if not points:
            await query.edit_message_text(
                "تعذر جلب ترجمة لهذا الفيديو.\nيمكنك التحميل بالجودة مباشرة.",
                reply_markup=quality_keyboard(show_summary=False),
            )
            return
        body = "\n".join(f"• {p}" for p in points)
        await query.edit_message_text(
            f"🧠 ملخص سريع ({lang or 'auto'}):\n\n{body}\n\nهل تريد التحميل؟",
            reply_markup=quality_keyboard(show_summary=False),
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

    allowed, limit_msg = store.can_download(user_id, is_owner)
    if not allowed:
        await query.edit_message_text(limit_msg)
        return

    quality, media_type = mapping[data]
    meta = _pending_meta.get(user_id) or {}
    dname = getattr(from_user, "first_name", None) or "مستخدم"

    cached = get_cached_file_id(url, media_type, quality) or store.file_cache.get(
        f"{url}|{media_type}|{quality}"
    )
    if cached:
        await query.edit_message_text("⚡ من الأرشيف — جاري الإرسال...")
        ok, fid = await send_from_cache_or_file(
            context.bot, query.message.chat_id, cached, None, media_type, meta.get("title") or "cached"
        )
        if ok:
            store.record_download(user_id)
            await _maybe_publish_feed(
                user_id=user_id,
                file_id=fid or cached,
                media_type=media_type,
                title=meta.get("title") or "media",
                url=url,
                thumbnail=meta.get("thumbnail"),
                from_user=from_user,
            )
            await _save(context.bot)
            await query.edit_message_text(f"✅ تم من الأرشيف · {limit_msg}")
            return

    await query.edit_message_text("⬇️ جاري التحميل... قد يستغرق حتى 3 دقائق.")
    try:
        result, dl_err = await download_media(url, quality=quality, media_type=media_type)
    except Exception as e:
        result, dl_err = None, str(e)
    if not result:
        detail = f"\n\n🔧 {dl_err[:400]}" if dl_err and is_owner else ""
        await query.edit_message_text("❌ فشل التحميل. جرّب جودة أقل أو رابطاً آخر." + detail)
        return

    file_id = await archive_and_get_file_id(
        context.bot,
        cfg.archive_channel_id,
        str(result.path),
        url,
        media_type,
        quality,
        result.title,
        downloader_name=dname,
        downloader_id=user_id,
    )
    ok, sent_id = await send_from_cache_or_file(
        context.bot,
        query.message.chat_id,
        file_id,
        str(result.path),
        media_type,
        result.title,
    )
    try:
        parent = result.path.parent
        if parent.exists() and str(parent).startswith("/tmp"):
            shutil.rmtree(parent, ignore_errors=True)
    except Exception:
        pass

    if ok:
        store.record_download(user_id)
        fid = sent_id or file_id
        if fid:
            set_cached_file_id(url, media_type, quality, fid)
            store.file_cache[f"{url}|{media_type}|{quality}"] = fid
        await _maybe_publish_feed(
            user_id=user_id,
            file_id=fid or "",
            media_type=media_type,
            title=result.title,
            url=url,
            thumbnail=result.thumbnail or meta.get("thumbnail"),
            from_user=from_user,
        )
        await _save(context.bot)
        await query.edit_message_text(f"✅ تم التحميل · {limit_msg}")
    else:
        await query.edit_message_text("❌ تعذر إرسال الملف.")


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
    if not file_id:
        return
    share = True if user_id == cfg.owner_id else store.get_share(user_id)
    if not share:
        logger.info("skip feed publish user=%s share=off", user_id)
        return
    name = getattr(from_user, "first_name", None) or "مستخدم"
    tags = guess_tags(title)
    squad = store.get_user_squad(user_id)
    try:
        item = await publish_feed_item(
            file_id=file_id,
            media_type=media_type,
            title=title,
            url=url,
            thumbnail=thumbnail,
            sharer_name=name,
            sharer_id=str(user_id),
            tags=tags,
            squad_code=squad,
        )
        logger.info("feed published id=%s", (item or {}).get("id"))
    except Exception as e:
        logger.warning("publish feed: %s", e)


async def testdl(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Owner-only: full pipeline test — download + archive + feed publish."""
    user = update.effective_user
    if not user or user.id != cfg.owner_id or not update.message:
        return
    args = context.args or []
    url = args[0] if args else "https://vt.tiktok.com/ZSqnF27su/"
    await update.message.reply_text(f"🧪 اختبار كامل (تحميل + أرشيف + رائج)\n{url}")
    try:
        from services.downloader import download_media, is_tiktok, normalize_url

        nurl = normalize_url(url)
        await update.message.reply_text(
            f"normalize={nurl}\nis_tiktok={is_tiktok(nurl)}\n"
            f"ARCHIVE={cfg.archive_channel_id or '❌ غير مضبوط'}"
        )
        result, err = await download_media(nurl, quality="720", media_type="video")
        if not result:
            await update.message.reply_text(f"❌ فشل التحميل\n{err}")
            return

        await update.message.reply_text(
            f"✅ تحميل نجح\ntitle={result.title[:80]}\nsize={result.filesize}"
        )

        fid = await archive_and_get_file_id(
            context.bot,
            cfg.archive_channel_id,
            str(result.path),
            nurl,
            "video",
            "720",
            result.title,
            downloader_name=user.first_name or "owner",
            downloader_id=user.id,
        )
        if fid:
            await update.message.reply_text(f"✅ أرشيف نجح\nfile_id={fid[:40]}...")
            set_cached_file_id(nurl, "video", "720", fid)
            store.file_cache[f"{nurl}|video|720"] = fid
        else:
            await update.message.reply_text(
                "⚠️ الأرشيف فشل — تأكد من ARCHIVE_CHANNEL_ID وأن البوت مشرف في القناة"
            )

        ok, sent_id = await send_from_cache_or_file(
            context.bot,
            update.effective_chat.id,
            fid,
            str(result.path),
            "video",
            result.title,
        )
        final_fid = sent_id or fid or ""
        if ok:
            await update.message.reply_text("✅ أُرسل إليك")
        else:
            await update.message.reply_text("⚠️ تعذر الإرسال لك")

        if final_fid:
            store.set_share(user.id, True)
            item = await publish_feed_item(
                file_id=final_fid,
                media_type="video",
                title=result.title,
                url=nurl,
                thumbnail=result.thumbnail,
                sharer_name=user.first_name or "owner",
                sharer_id=str(user.id),
                tags=guess_tags(result.title),
            )
            if item:
                await update.message.reply_text(
                    f"✅ نُشر في الرائج\nid={item.get('id')}\nافتح Mini-App → رائج الآن"
                )
            else:
                await update.message.reply_text("⚠️ نشر الرائج فشل (تحقق FEED_SECRET / FEED_API_URL)")
        else:
            await update.message.reply_text("⚠️ لا يوجد file_id — تخطي الرائج")

        store.record_download(user.id)
        await _save(context.bot)

        try:
            parent = result.path.parent
            if parent.exists() and str(parent).startswith("/tmp"):
                shutil.rmtree(parent, ignore_errors=True)
        except Exception:
            pass
    except Exception as e:
        logger.exception("testdl")
        await update.message.reply_text(f"💥 exception: {type(e).__name__}: {e}")


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    err = context.error
    if isinstance(err, Conflict):
        logger.warning("Conflict: %s", err)
        return
    if isinstance(err, (NetworkError, TimedOut)):
        logger.warning("Network: %s", err)
        return
    logger.exception("Unhandled: %s", err)


async def _post_init(app: Application) -> None:
    for attempt in range(3):
        try:
            await app.bot.delete_webhook(drop_pending_updates=True)
            break
        except Exception as e:
            logger.warning("delete_webhook: %s", e)
            await asyncio.sleep(2)
    await asyncio.sleep(2)
    store.mini_app_enabled = True
    store.set_share(cfg.owner_id, True)
    store.last_wakeup = time.time()
    await _force_menu_button(app.bot)
    logger.info("Bot ready owner=%s archive=%s", cfg.owner_id, cfg.archive_channel_id)


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
    app.add_handler(CommandHandler("testdl", testdl))
    app.add_handler(CallbackQueryHandler(callbacks))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, owner_text_handler), group=0)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, user_text_handler), group=1)
    app.add_error_handler(error_handler)
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
