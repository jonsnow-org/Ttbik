"""
Sham — Telegram thin client. Owner's own choice: "قررت ان اقوم
بالتجربة على بوت تلجرام افضل من اي مكان آخر" (decided to test via a
Telegram bot, better than anywhere else).

Exactly the thin client serve.py's own docstring already planned for:
this file contains NO model logic at all, only HTTP calls to serve.py's
real backend, same as web_app.py (the Streamlit UI) -- so both can run
side by side, or either alone, against the same running backend.

Run locally (after starting serve.py separately):
    uvicorn serve:app --port 8000 &
    python telegram_bot.py

Requires a real bot token from @BotFather in the SHAM_TELEGRAM_BOT_TOKEN
env var (see this project's own setup notes for exact BotFather steps).
"""

import asyncio
import base64
import io
import os
import sys

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))      # sham_small: sham_intent (no model code)
import studio_client
from sham_intent import media_caption, route_text
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

BACKEND_URL = os.environ.get("SHAM_SMALL_BACKEND_URL", "http://localhost:8000")
BOT_TOKEN = os.environ.get("SHAM_TELEGRAM_BOT_TOKEN", "").strip()

WELCOME = (
    "🧪 أهلاً بك في شام — نموذج ذكاء اصطناعي من الصفر، ملكية كاملة.\n\n"
    "هذه نسخة اختبار قبل التدريب الفعلي الكبير: تختبر أن كل شيء متصل "
    "ويعمل تقنياً، وليس جودة الناتج بعد.\n\n"
    "• اكتب بشكل طبيعي — بلا أوامر: «قم بتوليد صورة ارنب»، «أريد مقطع صوتي يقول مرحبا»، «اعطني فيديو لبحر»،\n"
    "  «ابحث عن سعر الذهب اليوم وآخر أخبار اليوم»، أو أي سؤال للدردشة.\n"
    "• أرسل صورة أو رسالة صوتية أو فيديو مباشرة وسأقرؤها؛ اكتب سؤالك في التعليق،\n"
    "  أو صِفها («هذه صورة قطتي…» / «تعلّم: …») لتُحفظ تجربة تعلّم محروسة.\n"
    "• الأوامر القديمة ما زالت تعمل:\n"
    "• /web سؤالك — بحث حي ثم إجابة\n"
    "• /weblearn سؤالك — مثل /web (التعلّم الذاتي تلقائي لكل بحث)\n"
    "• /image وصف الصورة\n"
    "• /audio نص ليتحول لصوت\n"
    "• /video وصف الفيديو\n"
    "• /health لفحص حالة الخادم"
)


async def _get(path: str, params: dict | None = None) -> requests.Response:
    return await asyncio.to_thread(requests.get, f"{BACKEND_URL}{path}", params=params, timeout=15)


async def _post(path: str, json: dict, timeout: float) -> requests.Response:
    return await asyncio.to_thread(requests.post, f"{BACKEND_URL}{path}", json=json, timeout=timeout)


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if update.message:
        await update.message.reply_text(WELCOME)


async def health(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    try:
        hosted = await asyncio.to_thread(studio_client.studio_status) if studio_client.enabled() else None
        r = await _get("/health")
        data = r.json()
        extra = (f"\n☁️ استوديو ModelScope: {hosted.get('phase')} — {hosted.get('detail', '')}" if hosted else "")
        await update.message.reply_text(
            f"✅ الخادم يعمل — {data['model_params']:,} معامل\n{data['note']}{extra}"
        )
    except Exception as e:
        await update.message.reply_text(f"❌ تعذر الوصول للخادم: {e}")


async def generate_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message or not update.message.text:
        return
    prompt = update.message.text.strip()
    if not prompt:
        return
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")
    # 2026-10-14: no slash commands needed — a plain message is routed (sham_intent): media requests, live search, or chat
    route, arg = route_text(prompt)
    if studio_client.enabled():      # the Studio routes the same way (chat_auto); an older Studio falls through to the old text path
        auto = await asyncio.to_thread(studio_client.chat_auto, prompt, 60, timeout=300.0 if route in ("image", "audio", "video") else 120.0)
        if studio_client.usable(auto, "text", "image", "audio", "video"):
            await _send_reply(update, auto, arg)
            return
    if route in ("image", "audio", "video"):
        await _media_reply(update, context, route, arg, studio_first=False)
        return
    if route == "web":
        await _web_reply(update, context, arg)
        return
    if studio_client.enabled():      # Sham hosted on the ModelScope Studio (always the newest published checkpoint): first choice
        hosted = await asyncio.to_thread(studio_client.generate_text, prompt, 60, timeout=100.0)
        if hosted:
            await update.message.reply_text(hosted)
            return
    try:
        r = await _post("/generate/text", {"prompt": prompt, "max_new_tokens": 60}, timeout=60)
        if r.status_code >= 400:
            await update.message.reply_text(f"❌ رفض الخادم الطلب: {r.json().get('detail', r.text)[:200]}")
            return
        text = r.json().get("text") or ""
        await update.message.reply_text(text or "(لم يكتب شام رداً هذه المرة — أعيدي صياغة السؤال)")
    except Exception as e:
        await update.message.reply_text(f"❌ تعذر الاتصال بالخادم: {e}")


async def _send_reply(update: Update, res: dict, caption: str = "") -> None:
    """Send what the Studio returned: a picture, a sound, a short video, or text (with the web footer when it came from a search)."""
    kind = res.get("type")
    if kind in ("image", "audio", "video") and res.get("b64"):
        data = io.BytesIO(base64.b64decode(res["b64"]))
        if kind == "image":
            await update.message.reply_photo(photo=data, caption=f"🎨 شام: {caption}"[:900])
        elif kind == "audio":
            await update.message.reply_audio(audio=data, filename="sham.wav")
        else:
            await update.message.reply_video(video=data, caption=f"🎬 شام: {caption}"[:900])
        return
    await update.message.reply_text(((res.get("text") or "").strip() or "(لم تُرجع شام رداً)")[:3500] + _learn_footer(res))


def _learn_footer(data: dict) -> str:
    footer = f"\n\n🔎 مصادر: {data['hits']}" if "hits" in data else ""
    if data.get("queued"):
        footer += f"\n🧬 حُفظت تجربة للتعلّم ({data.get('pending', '?')} بانتظار الدفعة)"
        if data.get("learning_started"):
            footer += " — بدأت جولة تعلّم محروسة الآن"
    elif data.get("reason") and ("hits" in data or "queued" in data):
        footer += f"\n🧬 لم تُحفظ تجربة: {data['reason']}"
    return footer


_SERVE_MEDIA = {"image": ("/generate/image", {}, "upload_photo", 120), "audio": ("/generate/audio", {}, "upload_voice", 120),
                "video": ("/generate/video", {"num_frames": 2}, "upload_video", 180)}


async def _media_reply(update: Update, context: ContextTypes.DEFAULT_TYPE, kind: str, prompt: str, studio_first: bool = True) -> None:
    """Use only the validated media backends hosted by Sham Studio; never return the legacy token-decoder image/slideshow as a real result."""
    _, _, action, _ = _SERVE_MEDIA[kind]
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action=action)
    if not studio_client.enabled():
        await update.message.reply_text(
            "❌ مولّد الوسائط الحقيقي غير متصل. اضبط MODELSCOPE_API_TOKEN، ثم تأكد من نشر استوديو شام v2 وأوزان SDXS/Piper؛ للفيديو يلزم أيضاً HF_VIDEO_SPACE_ID وHF_TOKEN."
        )
        return
    if not studio_first:
        await update.message.reply_text("❌ لم يُرجع استوديو شام نتيجة وسائط صالحة. تحقّق من /health وحالة الاستوديو ثم أعد المحاولة.")
        return
    hosted = await asyncio.to_thread(studio_client.generate_media, kind, prompt, timeout=300.0)
    if studio_client.usable(hosted, kind):
        await _send_reply(update, hosted, prompt)
        return
    message = hosted.get("text") if isinstance(hosted, dict) else None
    await update.message.reply_text(
        ("❌ تعذّر توليد الوسيط المطلوب دون نتيجة صالحة؛ لم أستخدم مفكّك رموز تجريبياً أو عرض شرائح بديلاً. " + (message or "تحقّق من إعدادات مولّد الوسائط وأعد المحاولة."))[:3500]
    )

async def generate_image(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    prompt = " ".join(context.args or []).strip()
    if not prompt:
        await update.message.reply_text("استخدم: /image وصف الصورة")
        return
    await _media_reply(update, context, "image", prompt)


async def generate_audio(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    prompt = " ".join(context.args or []).strip()
    if not prompt:
        await update.message.reply_text("استخدم: /audio نص ليتحول لصوت")
        return
    await _media_reply(update, context, "audio", prompt)


async def generate_video(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    prompt = " ".join(context.args or []).strip()
    if not prompt:
        await update.message.reply_text("استخدم: /video وصف الفيديو")
        return
    await _media_reply(update, context, "video", prompt)


async def ask_web(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    question = " ".join(context.args or []).strip()
    if not question:
        await update.message.reply_text("استخدم: /web سؤالك هنا")
        return
    await _web_reply(update, context, question)


async def _web_reply(update: Update, context: ContextTypes.DEFAULT_TYPE, question: str) -> None:
    """The engineer's /ask/web: live search, grounded answer, the turn kept as a learning experience (unchanged)."""
    learn = True   # every web answer becomes a learning experience automatically (guarded server-side)
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")
    try:
        r = await _post(
            "/ask/web",
            {"question": question, "max_new_tokens": 60, "learn": bool(learn)},
            timeout=120,
        )
        if r.status_code >= 400:
            await update.message.reply_text(f"❌ رفض الخادم الطلب: {r.text[:200]}")
            return
        data = r.json()
        answer = (data.get("answer") or "").strip() or "(لم تُرجع شام رداً)"
        hits = data.get("hits", 0)
        footer = f"\n\n🔎 مصادر: {hits}"
        if data.get("queued"):
            footer += f"\n🧬 حُفظت تجربة للتعلّم ({data.get('pending', '?')} بانتظار الدفعة)"
            if data.get("learning_started"):
                footer += " — بدأت جولة تعلّم محروسة الآن"
        elif learn and data.get("reason"):
            footer += f"\n🧬 لم تُحفظ تجربة: {data.get('reason', '')}"
        # لا روابط في الرد للمستخدم — لا نرفق sources/href
        await update.message.reply_text(answer[:3500] + footer)
    except Exception as e:
        await update.message.reply_text(f"❌ تعذر الاتصال بالخادم: {e}")


async def ask_web_learn(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    context.user_data["_learn_flag"] = True
    try:
        await ask_web(update, context)
    finally:
        context.user_data["_learn_flag"] = False


_MEDIA_NAMES = {"image": "sham.jpg", "audio": "sham.ogg", "video": "sham.mp4"}


def _incoming_media(msg):
    """(kind, telegram file) for a photo, voice note, audio file, video, round video, or a document of those types."""
    if msg.photo:
        return "image", msg.photo[-1]
    if msg.voice:
        return "audio", msg.voice
    if msg.audio:
        return "audio", msg.audio
    if msg.video:
        return "video", msg.video
    if msg.video_note:
        return "video", msg.video_note
    doc = msg.document
    if doc and doc.mime_type:
        for kind in ("image", "audio", "video"):
            if doc.mime_type.startswith(kind + "/"):
                return kind, doc
    return None, None


async def understand_media(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """A picture / sound / video sent directly: Sham reads it and answers. The caption is the question; a caption that DESCRIBES the media
    («هذه صورة …», «تعلّم: …») is kept with it as a guarded self-learning experience (both directions). Studio first, serve.py fallback."""
    msg = update.message
    if not msg:
        return
    kind, tg_file = _incoming_media(msg)
    if not kind:
        return
    question, teach = media_caption(msg.caption)
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="typing")
    try:
        f = await tg_file.get_file()
        raw = bytes(await f.download_as_bytearray())
    except Exception as e:
        await msg.reply_text(f"❌ تعذّر تنزيل الملف: {e}")
        return
    if studio_client.enabled():
        hosted = await asyncio.to_thread(studio_client.understand_media, kind, raw, question, teach, 2, timeout=240.0)
        if studio_client.usable(hosted, "text"):
            await msg.reply_text(hosted["text"].strip()[:3500] + _learn_footer(hosted))
            return
    data = {"question": question or {"image": "صف هذه الصورة.", "audio": "اكتب ما يقال في هذا المقطع.", "video": "صف هذا الفيديو."}[kind]}
    if teach:
        data["teach"] = teach
    if kind == "video":
        data["num_frames"] = "2"
    try:
        r = await asyncio.to_thread(requests.post, f"{BACKEND_URL}/ask/{kind}", files={"file": (_MEDIA_NAMES[kind], raw)}, data=data, timeout=240)
        if r.status_code >= 400:
            await msg.reply_text(f"❌ رفض الخادم الطلب: {r.text[:200]}")
            return
        out = r.json()
        await msg.reply_text(((out.get("answer") or "").strip() or "(لم تُرجع شام رداً)")[:3500] + _learn_footer(out))
    except Exception as e:
        await msg.reply_text(f"❌ تعذر الاتصال بالخادم: {e}")


def main() -> None:
    if not BOT_TOKEN:
        raise RuntimeError("SHAM_TELEGRAM_BOT_TOKEN is required — create a bot via @BotFather and set it.")
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("health", health))
    app.add_handler(CommandHandler("image", generate_image))
    app.add_handler(CommandHandler("audio", generate_audio))
    app.add_handler(CommandHandler("video", generate_video))
    app.add_handler(CommandHandler("web", ask_web))
    app.add_handler(CommandHandler("weblearn", ask_web_learn))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, generate_text))
    app.add_handler(MessageHandler(filters.PHOTO | filters.VOICE | filters.AUDIO | filters.VIDEO | filters.VIDEO_NOTE
                                   | filters.Document.IMAGE | filters.Document.AUDIO | filters.Document.VIDEO, understand_media))
    print(f"Sham Telegram bot starting — backend at {BACKEND_URL}")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
