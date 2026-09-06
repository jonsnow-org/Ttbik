import { Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { SITE_URL } from "@/lib/siteUrl";

// NOVA_BOT — the owner's $0-cost general AI assistant product (owner
// spec, 2026-09-05). Deliberately different in kind from every other
// template in this file's sibling modules: this one is a genuine
// general-purpose AI chat product with paid subscriptions, which is
// exactly what src/lib/groq.ts's SITE_IDENTITY_PROMPT comment says this
// site is NOT ("ليس متجراً يبيع وصولاً عاماً لذكاء اصطناعي كمنتج قائم
// بذاته") — that constraint was scoped to the narrow single-purpose
// free tools (writing assistant, text analyzer), not a blanket ban;
// the owner explicitly and repeatedly asked for this broader product
// across several confirmed rounds, so it's a deliberate exception, not
// an oversight. Flagged in docs/agent-state.json for visibility.
//
// This file is intentionally a THIN CLIENT: it owns zero AI logic and
// zero user/quota state — both live in the separate Python FastAPI
// service under ai-system/ (see ai-system/app/main.py), which talks to
// the same Supabase project directly via the NovaUser/NovaUsageLog/
// NovaSubscription tables (prisma/migration_19_nova_ai.sql). All this
// file does is forward each Telegram message over HTTP and relay the
// answer — the Streamlit web UI and any external API caller hit the
// exact same endpoint, so behavior never drifts between channels.
//
// Same private, owner-only deploy gate as MARRIAGE_BOT/JOBS_BOT/
// MEDICAL_BOT (NOVA_BOT_CREATOR_PASSWORD) — the owner deploys their own
// single instance, then real end-users interact with THAT bot and pay
// for higher quota via /subscribe, same commercial shape as AD_BOT
// already has today (owner deploys once, many external users use it).

const FASTAPI_URL = process.env.NOVA_FASTAPI_URL || "";
const INTERNAL_SECRET = process.env.NOVA_INTERNAL_SECRET || "";

// The model council writes plain Markdown (**bold**, # headers, etc.),
// but Telegram's own Markdown/MarkdownV2 parse modes require every
// special character to be perfectly escaped — a single stray one from
// model output throws and the message never arrives at all. Stripping
// the common markers to plain text is less pretty but never fails.
function stripMarkdown(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
}

async function callNovaBackend(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; data: any }> {
  if (!FASTAPI_URL || !INTERNAL_SECRET) {
    return { ok: false, data: { detail: "NOVA_FASTAPI_URL / NOVA_INTERNAL_SECRET غير مُعدّين على Vercel." } };
  }
  try {
    const res = await fetch(`${FASTAPI_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Internal-Secret": INTERNAL_SECRET },
      body: JSON.stringify(body),
      // Render's free instance type spins down after ~15 minutes idle and
      // takes 30-50s to wake on the next request — a 25s timeout was
      // aborting the very first message after any idle gap, every time.
      // Matches maxDuration=60 on the telegram route below.
      signal: AbortSignal.timeout(55000),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch {
    return { ok: false, data: { detail: "تعذر الاتصال بخادم Nova AI حالياً — حاول لاحقاً." } };
  }
}

// Voice/photo/document messages arrive as a file_id only — Telegram
// requires a second call (getFile) to resolve the actual download
// path, then a plain HTTPS fetch of api.telegram.org/file/... to get
// the bytes. FastAPI's /voice, /image, /file endpoints take base64
// JSON bodies (simpler than multipart from a serverless function), so
// this is the one conversion point for all three media types.
async function downloadTelegramFileAsBase64(bot: TelegramBot, fileId: string): Promise<string | null> {
  try {
    const file = await bot.api.getFile(fileId);
    if (!file.file_path) return null;
    const url = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch {
    return null;
  }
}

export async function handleNovaBotUpdate(bot: TelegramBot, _botRow: BotRow, update: any) {
  const msg = update.message;
  if (!msg?.chat?.id) return;

  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);

  if (msg.voice) {
    await handleVoiceMessage(bot, chatId, tgUserId, msg.voice.file_id);
    return;
  }

  if (msg.photo?.length) {
    // Telegram sends the same photo in multiple resolutions — the last
    // entry is always the largest/highest quality.
    const largest = msg.photo[msg.photo.length - 1];
    await handleImageMessage(bot, chatId, tgUserId, largest.file_id, msg.caption);
    return;
  }

  if (msg.document) {
    await handleDocumentMessage(bot, chatId, tgUserId, msg.document.file_id, msg.document.file_name, msg.caption);
    return;
  }

  if (!msg.text) return;
  const text = String(msg.text).trim();

  if (text === "/start") {
    await bot.api.sendMessage(
      chatId,
      "أنا نوفا NOVA مساعد ذكاء اصطناعي متعدد اللغات متعدد المصادر. ليس لدي مالك أو شركة لدي والد فقط هو من قام بابتكاري وتطويري والدي هو محمد الرشيد، وقد صممني لأحلّق في فضاء سوريا والعالم. أنا هنا لمساعدتك في الحصول على المعلومات التي تحتاجها بأدق وأوضح طريقة ممكنة.\n\nأهلاً بك مرة أخرى.....🤗\n\nاكتب أي سؤال مباشرة (أو أرسل رسالة صوتية، صورة، أو ملف PDF/Word)، وأرسل /ترقية في أي وقت لرفع حدك اليومي، أو /لوحتي لعرض لوحة حسابك."
    );
    return;
  }

  if (text === "/لوحتي" || text === "🎛 لوحتي" || text === "/dashboard") {
    const { ok, data } = await callNovaBackend("/whoami", { channel: "TELEGRAM", telegram_id: tgUserId });
    if (!ok || !data.nova_user_id) {
      await bot.api.sendMessage(chatId, "تعذر فتح لوحتك — حاول مرة أخرى بعد قليل.");
      return;
    }
    await bot.api.sendMessage(chatId, `🎛 لوحة حسابك (الخطة، الحد اليومي، سجل المحادثات، مفتاح API):\n${SITE_URL}/nova/dashboard?uid=${data.nova_user_id}`);
    return;
  }

  if (text === "/ترقية" || text === "/subscribe") {
    const { ok, data } = await callNovaBackend("/subscribe", { channel: "TELEGRAM", telegram_id: tgUserId });
    if (!ok) {
      await bot.api.sendMessage(chatId, `تعذر إرسال الطلب: ${data.detail || "خطأ غير معروف"}`);
      return;
    }
    const payUrl = data.nova_user_id ? `${SITE_URL}/pay/nova?uid=${data.nova_user_id}` : null;
    await bot.api.sendMessage(
      chatId,
      payUrl
        ? `${data.message}\n\nادفع الآن لتفعيل فوري (5$ شهرياً):\n${payUrl}`
        : data.message
    );
    return;
  }

  await bot.api.sendChatAction(chatId, "typing").catch(() => null);

  const { ok, data } = await callNovaBackend("/chat", { channel: "TELEGRAM", telegram_id: tgUserId, message: text });
  if (!ok) {
    await bot.api.sendMessage(chatId, data?.detail || "حدث خطأ — حاول مرة أخرى بعد قليل.");
    return;
  }

  await bot.api.sendMessage(chatId, stripMarkdown(data.answer));
}

async function handleVoiceMessage(bot: TelegramBot, chatId: number, tgUserId: string, fileId: string) {
  await bot.api.sendChatAction(chatId, "typing").catch(() => null);
  const audioBase64 = await downloadTelegramFileAsBase64(bot, fileId);
  if (!audioBase64) {
    await bot.api.sendMessage(chatId, "تعذّر تحميل الرسالة الصوتية — حاول مرة أخرى.");
    return;
  }
  const { ok, data } = await callNovaBackend("/voice", {
    channel: "TELEGRAM",
    telegram_id: tgUserId,
    audio_base64: audioBase64,
    filename: "voice.ogg",
  });
  if (!ok) {
    await bot.api.sendMessage(chatId, data?.detail || "حدث خطأ في معالجة الصوت — حاول مرة أخرى.");
    return;
  }
  await bot.api.sendMessage(chatId, stripMarkdown(data.answer));
}

async function handleImageMessage(bot: TelegramBot, chatId: number, tgUserId: string, fileId: string, caption?: string) {
  await bot.api.sendChatAction(chatId, "typing").catch(() => null);
  const imageBase64 = await downloadTelegramFileAsBase64(bot, fileId);
  if (!imageBase64) {
    await bot.api.sendMessage(chatId, "تعذّر تحميل الصورة — حاول مرة أخرى.");
    return;
  }
  const { ok, data } = await callNovaBackend("/image", {
    channel: "TELEGRAM",
    telegram_id: tgUserId,
    image_base64: imageBase64,
    caption: caption || null,
  });
  if (!ok) {
    await bot.api.sendMessage(chatId, data?.detail || "حدث خطأ في تحليل الصورة — حاول مرة أخرى.");
    return;
  }
  await bot.api.sendMessage(chatId, stripMarkdown(data.answer));
}

async function handleDocumentMessage(
  bot: TelegramBot,
  chatId: number,
  tgUserId: string,
  fileId: string,
  fileName: string | undefined,
  caption?: string
) {
  await bot.api.sendChatAction(chatId, "typing").catch(() => null);
  const fileBase64 = await downloadTelegramFileAsBase64(bot, fileId);
  if (!fileBase64) {
    await bot.api.sendMessage(chatId, "تعذّر تحميل الملف — حاول مرة أخرى.");
    return;
  }
  const { ok, data } = await callNovaBackend("/file", {
    channel: "TELEGRAM",
    telegram_id: tgUserId,
    file_base64: fileBase64,
    filename: fileName || "file.txt",
    question: caption || null,
  });
  if (!ok) {
    await bot.api.sendMessage(chatId, data?.detail || "حدث خطأ في قراءة الملف — حاول مرة أخرى.");
    return;
  }
  await bot.api.sendMessage(chatId, stripMarkdown(data.answer));
}
