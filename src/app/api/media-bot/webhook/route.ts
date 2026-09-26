import { NextRequest, NextResponse } from "next/server";
import { mediaDb } from "@/lib/mediaSocial";
import { getRenderUrl, hookPath, hookSecret, miniAppKeyboard, safeEqual, tg } from "@/lib/mediaFrontDoor";

// Telegram → Vercel → Render. See src/lib/mediaFrontDoor.ts.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FORWARD_TIMEOUT_MS = 25_000;
const RETRY_DELAY_MS = 12_000;
const RETRY_TIMEOUT_MS = 20_000;
const URL_RE = /https?:\/\/\S+/i;

type Outcome = "delivered" | "timeout" | "down";

async function forwardOnce(
  base: string, path: string, raw: string, secret: string, timeoutMs: number,
): Promise<{ ok: boolean; coldStart: boolean; down: boolean }> {
  try {
    const r = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
      body: raw,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (r.ok) return { ok: true, coldStart: false, down: false };
    if (r.status === 502 || r.status === 503) return { ok: false, coldStart: true, down: false };
    return { ok: false, coldStart: false, down: true };
  } catch (e) {
    if ((e as Error)?.name === "TimeoutError") return { ok: false, coldStart: false, down: false };
    return { ok: false, coldStart: false, down: true };
  }
}

async function forward(raw: string, secret: string): Promise<Outcome> {
  const base = await getRenderUrl().catch(() => "");
  if (!base) return "down";
  const path = hookPath();

  const r1 = await forwardOnce(base, path, raw, secret, FORWARD_TIMEOUT_MS);
  if (r1.ok) return "delivered";

  if (r1.coldStart) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    const r2 = await forwardOnce(base, path, raw, secret, RETRY_TIMEOUT_MS);
    if (r2.ok) return "delivered";
    return r2.down ? "down" : "timeout";
  }

  return r1.down ? "down" : "timeout";
}

async function enqueue(update: any): Promise<boolean> {
  const db = await mediaDb();
  if (!db || typeof update?.update_id !== "number") return false;
  const { error } = await db.from("media_bot_queue").upsert({ update_id: update.update_id, payload: update });
  return !error;
}

// "/start clone_<id>" from the mini-app: the file is already on Telegram's
// servers, so it can be sent without the download server.
async function sendCloned(chatId: number, itemId: string): Promise<boolean> {
  const db = await mediaDb();
  if (!db) return false;
  const { data } = await db.from("media_feed").select("id,file_id,media_type,title,clones").eq("id", itemId).maybeSingle();
  const item = data as any;
  if (!item?.file_id) return false;
  const type = String(item.media_type || "video");
  const title = String(item.title || "media").slice(0, 64);
  const res =
    type === "audio"
      ? await tg("sendAudio", { chat_id: chatId, audio: item.file_id, title })
      : type === "voice"
        ? await tg("sendVoice", { chat_id: chatId, voice: item.file_id })
        : await tg("sendVideo", { chat_id: chatId, video: item.file_id, supports_streaming: true });
  if (!res?.ok) return false;
  await db.from("media_feed").update({ clones: Number(item.clones || 0) + 1 }).eq("id", item.id);
  return true;
}

async function fallback(update: any, queued: boolean) {
  const cq = update.callback_query;
  if (cq) {
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: "⏳ خادم التحميل في استراحة قصيرة، جرّب بعد قليل." });
    return;
  }

  if (update.pre_checkout_query) {
    await tg("answerPreCheckoutQuery", {
      pre_checkout_query_id: update.pre_checkout_query.id,
      ok: false,
      error_message: "الخدمة في صيانة سريعة، حاول بعد قليل.",
    });
    return;
  }

  const msg = update.message;
  const chatId = msg?.chat?.id;
  if (!chatId || msg.chat.type !== "private") return;
  const text = String(msg.text || "").trim();

  if (text.startsWith("/start clone_")) {
    if (await sendCloned(chatId, text.slice("/start clone_".length).trim())) {
      await tg("sendMessage", { chat_id: chatId, text: "⚡ تم الإرسال فوراً من الكاش." });
    } else {
      await tg("sendMessage", { chat_id: chatId, text: "انتهت صلاحية هذا الملف أو غير موجود.", reply_markup: miniAppKeyboard() });
    }
    return;
  }
  if (URL_RE.test(text)) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: queued
        ? "📥 استلمنا رابطك وحفظناه.\nخادم التحميل في استراحة قصيرة، وسيصلك الملف تلقائياً فور عودته — لا حاجة لإعادة الإرسال.\n\n📱 في الأثناء التطبيق المصغر يعمل بالكامل."
        : "⏳ خادم التحميل في استراحة قصيرة. أعد إرسال الرابط بعد قليل.\n\n📱 التطبيق المصغر يعمل بالكامل في الأثناء.",
      reply_markup: miniAppKeyboard(),
    });
    return;
  }
  await tg("sendMessage", {
    chat_id: chatId,
    text:
      "مرحباً 👋\nخادم التحميل في استراحة قصيرة الآن ⏳\n\n" +
      "📱 التطبيق المصغر يعمل بالكامل: تصفّح، شاهد، واحصل على أي فيديو منه فوراً.\n" +
      "🔗 وإن أرسلت رابطاً نحفظه ونرسل لك الملف تلقائياً فور عودة الخادم.",
    reply_markup: miniAppKeyboard(),
  });
}

export async function POST(req: NextRequest) {
  const secret = hookSecret();
  if (!secret || !safeEqual(req.headers.get("x-telegram-bot-api-secret-token") || "", secret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const raw = await req.text();
  let update: any;
  try {
    update = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const outcome = await forward(raw, secret);
  if (outcome === "delivered") return NextResponse.json({ ok: true });

  // Not confirmed delivered: keep download requests for the bot to replay
  // (it skips update_ids it already handled), and answer the user now if
  // the server is really down rather than just waking up.
  try {
    const text = String(update?.message?.text || "");
    const queued = URL_RE.test(text) && !text.startsWith("/") ? await enqueue(update) : false;
    if (outcome === "down") await fallback(update, queued);
  } catch (e) {
    console.error("[media-front-door] fallback failed", e);
  }
  // Always 200: a non-2xx would make Telegram redeliver and repeat all this.
  return NextResponse.json({ ok: true });
}
