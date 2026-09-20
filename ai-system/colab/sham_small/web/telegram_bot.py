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
import io
import os

import requests
from telegram import Update
from telegram.ext import Application, CommandHandler, ContextTypes, MessageHandler, filters

BACKEND_URL = os.environ.get("SHAM_SMALL_BACKEND_URL", "http://localhost:8000")
BOT_TOKEN = os.environ.get("SHAM_TELEGRAM_BOT_TOKEN", "").strip()

WELCOME = (
    "🧪 أهلاً بك في شام — نموذج ذكاء اصطناعي من الصفر، ملكية كاملة.\n\n"
    "هذه نسخة اختبار قبل التدريب الفعلي الكبير: تختبر أن كل شيء متصل "
    "ويعمل تقنياً، وليس جودة الناتج بعد.\n\n"
    "• أرسل أي رسالة نصية مباشرة لتوليد نص.\n"
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
        r = await _get("/health")
        data = r.json()
        await update.message.reply_text(
            f"✅ الخادم يعمل — {data['model_params']:,} معامل\n{data['note']}"
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
    try:
        r = await _post("/generate/text", {"prompt": prompt, "max_new_tokens": 60}, timeout=60)
        if r.status_code >= 400:
            await update.message.reply_text(f"❌ رفض الخادم الطلب: {r.json().get('detail', r.text)[:200]}")
            return
        text = r.json().get("text") or ""
        await update.message.reply_text(text or "(نص فارغ — طبيعي مع نموذج غير مُدرَّب بعد)")
    except Exception as e:
        await update.message.reply_text(f"❌ تعذر الاتصال بالخادم: {e}")


async def generate_image(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    prompt = " ".join(context.args or []).strip()
    if not prompt:
        await update.message.reply_text("استخدم: /image وصف الصورة")
        return
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="upload_photo")
    try:
        r = await _post("/generate/image", {"prompt": prompt}, timeout=120)
        if r.status_code >= 400:
            await update.message.reply_text(f"❌ رفض الخادم الطلب: {r.text[:200]}")
            return
        await update.message.reply_photo(
            photo=io.BytesIO(r.content), caption="ناتج حقيقي من النموذج (عشوائي قبل التدريب الفعلي)"
        )
    except Exception as e:
        await update.message.reply_text(f"❌ تعذر الاتصال بالخادم: {e}")


async def generate_audio(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    prompt = " ".join(context.args or []).strip()
    if not prompt:
        await update.message.reply_text("استخدم: /audio نص ليتحول لصوت")
        return
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="upload_voice")
    try:
        r = await _post("/generate/audio", {"prompt": prompt}, timeout=120)
        if r.status_code >= 400:
            await update.message.reply_text(f"❌ رفض الخادم الطلب: {r.text[:200]}")
            return
        await update.message.reply_audio(audio=io.BytesIO(r.content), filename="sham.wav")
    except Exception as e:
        await update.message.reply_text(f"❌ تعذر الاتصال بالخادم: {e}")


async def generate_video(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not update.message:
        return
    prompt = " ".join(context.args or []).strip()
    if not prompt:
        await update.message.reply_text("استخدم: /video وصف الفيديو")
        return
    await context.bot.send_chat_action(chat_id=update.effective_chat.id, action="upload_video")
    try:
        r = await _post("/generate/video", {"prompt": prompt, "num_frames": 2}, timeout=180)
        if r.status_code >= 400:
            await update.message.reply_text(f"❌ رفض الخادم الطلب: {r.text[:200]}")
            return
        await update.message.reply_video(
            video=io.BytesIO(r.content), caption="ناتج حقيقي من النموذج (عشوائي قبل التدريب الفعلي)"
        )
    except Exception as e:
        await update.message.reply_text(f"❌ تعذر الاتصال بالخادم: {e}")


def main() -> None:
    if not BOT_TOKEN:
        raise RuntimeError("SHAM_TELEGRAM_BOT_TOKEN is required — create a bot via @BotFather and set it.")
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("health", health))
    app.add_handler(CommandHandler("image", generate_image))
    app.add_handler(CommandHandler("audio", generate_audio))
    app.add_handler(CommandHandler("video", generate_video))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, generate_text))
    print(f"Sham Telegram bot starting — backend at {BACKEND_URL}")
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    main()
