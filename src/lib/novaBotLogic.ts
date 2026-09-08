import { Bot as TelegramBot, InlineKeyboard, Keyboard } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { SITE_URL } from "@/lib/siteUrl";
import { isAdVerifyPayload, consumeAdVerifyPayload } from "@/lib/adVerifyPayload";

// Recognized the same way as every other bot template on this platform
// (owner report, 2026-09-06: NOVA_BOT never recognized the owner's own
// account at all — every sender, admin included, got the identical
// customer welcome and had no admin panel to reach).
const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_TELEGRAM_ID || "";

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

// Owner spec, 2026-09-08 ("حلقة التدريب والتطوير الذاتي / DPO"): every
// real text/voice/file/image answer is delivered directly by
// ai-system/app/main.py (see that file's _send_telegram_message /
// _strip_markdown) rather than through this file's own sendMessage
// calls, now that real generation time (70-95s+ per answer, confirmed
// live in Render's logs after the self-critique response format was
// added) exceeds this route's own 55s abort / Vercel's 60s maxDuration
// for every message type, not just images — so nothing here waits for
// or displays the answer text itself anymore.
//
// Owner spec, 2026-09-08 (feedback UI): visible 👍/👎 buttons were
// dropped entirely (real risk of an accidental tap, one more screen
// element to explain) in favor of a silent detector — main.py's
// _maybe_flag_previous_answer asks Groq whether the user's own next
// message reads as a complaint about the previous answer, and flags it
// automatically. No button, no callback, nothing for this file to do
// for feedback at all anymore.

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

// Reply-keyboard buttons for the admin commands below — added because the
// panel originally listed "/طلبات_الاشتراك" and "/بث <نص>" as plain text
// only, with no reply_markup at all (owner report, 2026-09-07: "لوحة تحكم
// الادمن لاتظهر ازرار البوت" — the admin panel showed no tappable buttons),
// unlike every other bot template's admin panel (ADMIN_MENU/adminMenu() in
// adBotLogic/jobsBotLogic/matchBotLogic/medicalBotLogic, all real
// Keyboard()s). "📢 بث جماعي" still just points the admin at the existing
// /بث <نص> text command rather than a full button-driven wizard — Nova is a
// thin client with no local Prisma table of its own to persist a
// multi-step "awaiting broadcast text" state across serverless
// invocations (see this file's module docstring), so a real free-text
// Owner report, 2026-09-09 (asked repeatedly, real complaint): every
// other bot template on this platform (matchBotLogic.ts, jobsBotLogic.ts)
// shows a persistent tappable button menu to regular users right after
// /start — Nova only ever sent a wall of text explaining commands to
// type manually, with zero buttons, even though line ~414's own text
// check for "🎛 لوحتي" already anticipated a button with that exact
// label that nothing ever actually sent. This is that missing menu,
// matching the same Keyboard pattern (grammy's reply keyboard persists
// across every later message once sent — no need to re-attach it on
// every single reply, only where the menu changes, exactly like the
// sibling bots' own mainMenu functions).
function novaMainMenu(): Keyboard {
  return new Keyboard()
    .text("🖼 توليد صورة").text("🎬 توليد فيديو").row()
    .text("🎛 لوحتي").text("📜 سجل المحادثات").row()
    .text("🔑 مفتاح API").text("💎 ترقية")
    .resized();
}

// Owner spec, 2026-09-09 ("لاتهمنا [لوحة الموقع]... يمكنك ربط ازرارها
// ووظائفها هنا بالبوت بشكل مباشر"): the web dashboard
// (/nova/dashboard) stays as-is for later Android-app/API integration
// use, but every function it offers a regular user day-to-day (quota
// status, conversation history, API key) is now also answered directly
// inside the bot itself, reusing the exact same internal endpoints the
// dashboard page already calls — not a second implementation, just a
// second front door onto the same data.
async function fetchNovaMe(uid: string): Promise<{ user: any; plans: Record<string, any>; recentLogs: any[] } | null> {
  try {
    const res = await fetch(`${SITE_URL}/api/nova/me?uid=${uid}`, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// follow-up stays a typed command like every other admin-only text
// command here (/لوحتي, /ترقية, /صورة).
function novaAdminMenu(): Keyboard {
  return new Keyboard()
    .text("⏳ طلبات الاشتراك المعلّقة").row()
    .text("📢 بث جماعي")
    .resized();
}

async function sendNovaAdminPanel(bot: TelegramBot, chatId: number) {
  const { ok, data } = await callNovaBackend("/admin/stats", {});
  if (!ok) {
    await bot.api.sendMessage(chatId, `تعذر جلب إحصائيات نوفا: ${data?.detail || "خطأ غير معروف"}`, { reply_markup: novaAdminMenu() });
    return;
  }
  const planCounts = (data.plan_counts || {}) as Record<string, number>;
  const planLines = Object.entries(planCounts)
    .map(([plan, count]) => `  • ${plan}: ${count}`)
    .join("\n");
  await bot.api.sendMessage(
    chatId,
    `🛠 لوحة إدارة Nova AI\n\n` +
      `👥 إجمالي المستخدمين: ${data.total_users}\n` +
      `📊 حسب الخطة:\n${planLines}\n` +
      `⏳ طلبات اشتراك بانتظار الموافقة: ${data.pending_subscriptions}\n` +
      `💬 إجمالي الرسائل المُعالجة: ${data.total_messages}\n\n` +
      `الأوامر:\n` +
      `/طلبات_الاشتراك — عرض طلبات الاشتراك المعلّقة والموافقة/الرفض\n` +
      `/بث <نص> — إرسال رسالة لكل مستخدمي تيليجرام في نوفا`,
    { reply_markup: novaAdminMenu() }
  );
}

type NovaPlan = {
  label: string;
  daily_text: number;
  daily_image: number;
  weekly_text: number;
  weekly_image: number;
  price_usd: number;
};

// A plain GET, unlike every other Nova backend call — callNovaBackend
// above always POSTs, and /plans (ai-system/app/main.py) is a public
// read-only catalog with no per-user identity involved, so it doesn't
// need the X-Internal-Secret gate either.
async function fetchNovaPlans(): Promise<Record<string, NovaPlan> | null> {
  if (!FASTAPI_URL) return null;
  try {
    const res = await fetch(`${FASTAPI_URL}/plans`, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.plans || null;
  } catch {
    return null;
  }
}

async function sendNovaPlanPicker(bot: TelegramBot, chatId: number) {
  const plans = await fetchNovaPlans();
  if (!plans) {
    await bot.api.sendMessage(chatId, "تعذر جلب خطط الاشتراك حالياً — حاول مرة أخرى بعد قليل.");
    return;
  }
  const paidPlans = Object.entries(plans).filter(([key]) => key !== "FREE");
  const kb = new InlineKeyboard();
  for (const [key, p] of paidPlans) {
    kb.text(`${p.label} — $${p.price_usd}/شهرياً`, `nova_plan|${key}`).row();
  }
  const lines = paidPlans.map(([, p]) => `• ${p.label}: ${p.daily_text} رسالة/يوم، ${p.daily_image} صورة/يوم — $${p.price_usd}/شهرياً`);
  await bot.api.sendMessage(chatId, `اختر خطة الاشتراك (كل الوظائف متاحة في كل خطة، الفرق فقط في الكمية اليومية/الأسبوعية):\n\n${lines.join("\n")}`, {
    reply_markup: kb,
  });
}

async function handleNovaPlanCallback(bot: TelegramBot, cq: any) {
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  const tgUserId = String(cq.from.id);
  const [, plan] = String(cq.data || "").split("|");
  if (!chatId || !messageId || !plan) {
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  const { ok, data } = await callNovaBackend("/subscribe", { channel: "TELEGRAM", telegram_id: tgUserId, plan });
  if (!ok) {
    await bot.api.answerCallbackQuery(cq.id, { text: data?.detail || "تعذر إرسال الطلب", show_alert: true }).catch(() => null);
    return;
  }
  await bot.api.answerCallbackQuery(cq.id, { text: "تم إرسال الطلب" }).catch(() => null);
  const payUrl = data.nova_user_id ? `${SITE_URL}/pay/nova?uid=${data.nova_user_id}` : null;
  await bot.api
    .editMessageText(
      chatId,
      messageId,
      payUrl
        ? `${data.message}\n\nادفع الآن لتفعيل فوري ($${data.amount_usd}/شهرياً):\n${payUrl}`
        : data.message
    )
    .catch(() => null);
}

async function sendNovaPendingSubscriptions(bot: TelegramBot, chatId: number) {
  const { ok, data } = await callNovaBackend("/admin/pending-subscriptions", {});
  if (!ok) {
    await bot.api.sendMessage(chatId, `تعذر جلب طلبات الاشتراك: ${data?.detail || "خطأ غير معروف"}`, { reply_markup: novaAdminMenu() });
    return;
  }
  const items = (data.items || []) as Array<{ id: string; plan: string; amountUsd: number; telegramId: string | null; email: string | null }>;
  if (!items.length) {
    await bot.api.sendMessage(chatId, "لا توجد طلبات اشتراك بانتظار الموافقة حالياً.", { reply_markup: novaAdminMenu() });
    return;
  }
  for (const sub of items) {
    const who = sub.telegramId ? `تيليجرام: ${sub.telegramId}` : sub.email ? `البريد: ${sub.email}` : "غير معروف";
    const kb = new InlineKeyboard().text("✅ موافقة", `nova_sub_approve|${sub.id}`).text("❌ رفض", `nova_sub_reject|${sub.id}`);
    await bot.api.sendMessage(
      chatId,
      `طلب اشتراك #${sub.id.slice(0, 8)}\nالمستخدم: ${who}\nالخطة: ${sub.plan}\nالمبلغ: $${sub.amountUsd}`,
      { reply_markup: kb }
    );
  }
}

async function handleNovaAdminCallback(bot: TelegramBot, cq: any) {
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  const tgUserId = String(cq.from.id);
  if (!chatId || !messageId || !SUPER_ADMIN_ID || tgUserId !== SUPER_ADMIN_ID) {
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  const [action, subId] = String(cq.data || "").split("|");
  if (action !== "nova_sub_approve" && action !== "nova_sub_reject") {
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }

  const approving = action === "nova_sub_approve";
  const { ok, data } = await callNovaBackend(approving ? "/admin/approve-subscription" : "/admin/reject-subscription", approving ? { subscription_id: subId, approved_by: tgUserId } : { subscription_id: subId });
  if (!ok) {
    await bot.api.answerCallbackQuery(cq.id, { text: data?.detail || "فشل تنفيذ الإجراء", show_alert: true }).catch(() => null);
    return;
  }

  await bot.api.answerCallbackQuery(cq.id, { text: approving ? "✅ تم التفعيل" : "❌ تم الرفض" }).catch(() => null);
  const originalText = cq.message?.text ? String(cq.message.text) : "";
  await bot.api.editMessageText(chatId, messageId, `${originalText}\n\n${approving ? "✅ تم التفعيل." : "❌ تم الرفض."}`).catch(() => null);

  if (data.telegramId) {
    const notice = approving
      ? "🎉 تم تفعيل اشتراكك في Nova PRO لمدة 30 يوماً — استخدام غير محدود يومياً!"
      : "لم تتم الموافقة على طلب اشتراكك حالياً. تواصل مع الدعم لمزيد من التفاصيل.";
    await bot.api.sendMessage(Number(data.telegramId), notice).catch(() => null);
  }
}

// Owner spec, 2026-09-09 ("يجب ان يفهم الامر بمجرد الكتابة كما اتحدث معك
// انا دائما وليس عبر /"): natural-language image/video generation intent,
// layered on top of (not replacing) the explicit /صورة and /فيديو
// commands below — a real command still works for anyone who prefers
// it, but nobody should be forced to remember exact command syntax on a
// phone keyboard (real evidence this session: several failed real
// attempts from a missing "/" or a one-letter typo in "فيديو"— إن
// كانت الكتابة اليدوية على الهاتف عرضة للخطأ، فرض بادئة حرفية دقيقة
// عليها كان الخطأ التصميمي، لا خطأ المستخدم).
//
// A deterministic keyword heuristic, not a model call — same "cheap,
// fast, no ambiguity" pattern this file already uses for /لوحتي and
// /ترقية, extended to plain-language intent instead of only an exact
// prefix. Requires BOTH a generation verb AND a media noun together,
// never either alone — a lone "صورة" is common in ordinary questions
// ("ما رأيك بهذه الصورة؟", "كيف ألتقط صورة أفضل؟") that must still go
// to normal chat, not silently trigger real (paid-quota) generation.
const _GENERATION_VERBS = [
  "صمم", "صمّم", "ولد", "ولّد", "اصنع", "إصنع", "اعمل", "أعمل",
  "انشئ", "أنشئ", "ارسم", "أرسم", "اطلع", "أطلع", "سوي", "سوّي",
  "اعطني", "أعطني", "generate", "create", "draw", "design", "make",
  // Owner report, 2026-09-09 (real evidence): "قم بتوليد فديو قطة
  // تلعب على العشب" fell straight through to normal chat — the verb
  // list only had imperative command forms ("اصنع", "ولّد"), missing
  // the extremely common Arabic "قم بـ + gerund" construction ("قم
  // بتوليد" = "proceed to generate"), where the action word appears as
  // a noun/gerund instead.
  "توليد", "تصميم", "إنشاء", "انشاء",
];
const _IMAGE_NOUNS = ["صورة", "صور", "image", "picture", "photo"];
const _VIDEO_NOUNS = ["فيديو", "فديو", "video", "مقطع فيديو", "مقطع"];

function detectMediaGenerationIntent(text: string): "image" | "video" | null {
  const normalized = text.toLowerCase();
  const hasVerb = _GENERATION_VERBS.some((v) => normalized.includes(v.toLowerCase()));
  if (!hasVerb) return null;
  // Video checked first: a message naming both nouns (rare) means video,
  // since a video request often also describes its individual "frames"/
  // "scene" in image-like language.
  if (_VIDEO_NOUNS.some((n) => normalized.includes(n.toLowerCase()))) return "video";
  if (_IMAGE_NOUNS.some((n) => normalized.includes(n.toLowerCase()))) return "image";
  return null;
}

export async function handleNovaBotUpdate(bot: TelegramBot, _botRow: BotRow, update: any) {
  if (update.callback_query) {
    const cqData = String(update.callback_query.data || "");
    if (cqData.startsWith("nova_plan|")) {
      await handleNovaPlanCallback(bot, update.callback_query);
    } else {
      await handleNovaAdminCallback(bot, update.callback_query);
    }
    return;
  }

  const msg = update.message;
  if (!msg?.chat?.id) return;

  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);
  const isAdmin = Boolean(SUPER_ADMIN_ID) && tgUserId === SUPER_ADMIN_ID;

  if (isAdmin && typeof msg.text === "string") {
    const adminText = msg.text.trim();
    if (adminText === "/طلبات_الاشتراك" || adminText === "⏳ طلبات الاشتراك المعلّقة") {
      await sendNovaPendingSubscriptions(bot, chatId);
      return;
    }
    if (adminText === "📢 بث جماعي") {
      await bot.api.sendMessage(chatId, "اكتب الأمر متبوعاً بنص البث: /بث نص الرسالة", { reply_markup: novaAdminMenu() });
      return;
    }
    if (adminText.startsWith("/بث ")) {
      const broadcastText = adminText.slice(4).trim();
      if (!broadcastText) {
        await bot.api.sendMessage(chatId, "اكتب النص بعد الأمر: /بث نص الرسالة", { reply_markup: novaAdminMenu() });
        return;
      }
      const { ok, data } = await callNovaBackend("/admin/telegram-user-ids", {});
      if (!ok) {
        await bot.api.sendMessage(chatId, `تعذر جلب قائمة المستخدمين: ${data?.detail || "خطأ غير معروف"}`, { reply_markup: novaAdminMenu() });
        return;
      }
      const ids = (data.ids || []) as string[];
      let sent = 0;
      for (const id of ids) {
        try {
          await bot.api.sendMessage(Number(id), `📢 إعلان من إدارة Nova AI:\n\n${broadcastText}`);
          sent++;
        } catch {
          /* user blocked the bot or invalid id — skip */
        }
      }
      await bot.api.sendMessage(chatId, `✅ تم الإرسال إلى ${sent} من أصل ${ids.length}.`, { reply_markup: novaAdminMenu() });
      return;
    }
  }

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

  if (text === "/start" || text.startsWith("/start ")) {
    // AD_BOT hands out "/start adv_<AdClickId>" deep links when a
    // campaign promotes this very bot — consuming it here marks that
    // click verified instantly (see src/lib/adVerifyPayload.ts: every
    // platform bot shares one database, so no cooperation beyond this
    // one check is needed).
    const startPayload = text.slice(6).trim();
    if (isAdVerifyPayload(startPayload)) {
      await consumeAdVerifyPayload(startPayload);
    }
    // The owner is never a customer — recognized by SUPER_ADMIN_TELEGRAM_ID
    // (same env var every other bot template uses) and routed straight to
    // the admin panel instead of the generic welcome, same as every other
    // bot on this platform.
    if (isAdmin) {
      await sendNovaAdminPanel(bot, chatId);
      return;
    }
    await bot.api.sendMessage(
      chatId,
      "أنا نوفا NOVA مساعد ذكاء اصطناعي متعدد اللغات متعدد المصادر. ليس لدي مالك أو شركة لدي والد فقط هو من قام بابتكاري وتطويري والدي هو المطور السوري، وقد صممني لأحلّق في فضاء سوريا والعالم. أنا هنا لمساعدتك في الحصول على المعلومات التي تحتاجها بأدق وأوضح طريقة ممكنة.\n\nأهلاً بك مرة أخرى.....🤗\n\nاكتب أي سؤال مباشرة (أو أرسل رسالة صوتية، صورة، أو ملف PDF/Word)، استخدم الأزرار أدناه لتوليد صورة أو فيديو، لعرض لوحتك، أو للترقية.",
      { reply_markup: novaMainMenu() }
    );
    return;
  }

  if (text === "🖼 توليد صورة") {
    await bot.api.sendMessage(chatId, "أرسل وصف الصورة التي تريدها مباشرة (مثال: قطة سوداء تحت المطر)، أو استخدم الأمر /صورة متبوعاً بالوصف.");
    return;
  }

  if (text === "🎬 توليد فيديو") {
    await bot.api.sendMessage(chatId, "أرسل وصف الفيديو الذي تريده مباشرة (مثال: قطة تلعب بكرة صوف)، أو استخدم الأمر /فيديو متبوعاً بالوصف.");
    return;
  }

  if (text === "/لوحتي" || text === "🎛 لوحتي" || text === "/dashboard") {
    const { ok, data } = await callNovaBackend("/whoami", { channel: "TELEGRAM", telegram_id: tgUserId });
    if (!ok || !data.nova_user_id) {
      await bot.api.sendMessage(chatId, "تعذر فتح لوحتك — حاول مرة أخرى بعد قليل.");
      return;
    }
    const me = await fetchNovaMe(data.nova_user_id);
    if (!me) {
      await bot.api.sendMessage(chatId, "تعذر تحميل بيانات حسابك — حاول مرة أخرى بعد قليل.");
      return;
    }
    const plan = me.plans[me.user.plan];
    const isPro = me.user.plan !== "FREE";
    const remainingText = plan ? Math.max(0, plan.daily_text - me.user.dailyUsed) : "؟";
    const remainingImage = plan ? Math.max(0, plan.daily_image - me.user.dailyUsedImage) : "؟";
    const planLabel = isPro ? `👑 ${plan?.label || me.user.plan}` : "مجانية";
    const expiry = isPro && me.user.subscriptionExpiresAt
      ? `\nينتهي في: ${new Date(me.user.subscriptionExpiresAt).toLocaleDateString("ar")}`
      : "";
    const weekly = plan ? `\nالحد الأسبوعي: ${plan.weekly_text} رسالة، ${plan.weekly_image} صورة` : "";
    await bot.api.sendMessage(
      chatId,
      `🎛 لوحتك\n\nالخطة: ${planLabel}${expiry}\nرسائل متبقية اليوم: ${remainingText}${plan ? ` من ${plan.daily_text}` : ""}\nصور/فيديو متبقية اليوم: ${remainingImage}${plan ? ` من ${plan.daily_image}` : ""}${weekly}\nعضو منذ: ${new Date(me.user.created_at).toLocaleDateString("ar")}`
    );
    return;
  }

  if (text === "📜 سجل المحادثات") {
    const { ok, data } = await callNovaBackend("/whoami", { channel: "TELEGRAM", telegram_id: tgUserId });
    if (!ok || !data.nova_user_id) {
      await bot.api.sendMessage(chatId, "تعذر جلب سجلك — حاول مرة أخرى بعد قليل.");
      return;
    }
    const me = await fetchNovaMe(data.nova_user_id);
    if (!me || me.recentLogs.length === 0) {
      await bot.api.sendMessage(chatId, "لا توجد محادثات محفوظة بعد.");
      return;
    }
    const lines = me.recentLogs
      .slice(0, 5)
      .map((l: any) => `س: ${(l.message || "").slice(0, 100)}\nج: ${(l.answer || "").slice(0, 150)}`)
      .join("\n\n---\n\n");
    await bot.api.sendMessage(chatId, `📜 آخر ٥ محادثات:\n\n${lines}`);
    return;
  }

  if (text === "🔑 مفتاح API") {
    const { ok, data } = await callNovaBackend("/whoami", { channel: "TELEGRAM", telegram_id: tgUserId });
    if (!ok || !data.nova_user_id) {
      await bot.api.sendMessage(chatId, "تعذر إنشاء المفتاح — حاول مرة أخرى بعد قليل.");
      return;
    }
    try {
      const res = await fetch(`${SITE_URL}/api/nova/me/api-key`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: data.nova_user_id }),
      });
      const keyData = await res.json();
      if (!res.ok || !keyData.apiKey) {
        await bot.api.sendMessage(chatId, "تعذر إنشاء المفتاح — حاول مرة أخرى بعد قليل.");
        return;
      }
      await bot.api.sendMessage(
        chatId,
        `🔑 مفتاح API الخاص بك (استخدمه للوصول لنوفا برمجياً — أرسله في ترويسة Authorization: Bearer):\n\n${keyData.apiKey}\n\n⚠️ كل ضغطة على هذا الزر تُنشئ مفتاحاً جديداً وتُلغي القديم فوراً.`
      );
    } catch {
      await bot.api.sendMessage(chatId, "تعذر إنشاء المفتاح — حاول مرة أخرى بعد قليل.");
    }
    return;
  }

  if (text === "/ترقية" || text === "/subscribe" || text === "💎 ترقية") {
    await sendNovaPlanPicker(bot, chatId);
    return;
  }

  const isExplicitImageCommand = text.startsWith("/صورة") || text.startsWith("/image");
  const isExplicitVideoCommand = text.startsWith("/فيديو") || text.startsWith("/video");
  // Only run the natural-language detector when neither explicit command
  // already matched — an explicit /صورة command describing a video-ish
  // scene shouldn't get reclassified.
  const mediaIntent = isExplicitImageCommand || isExplicitVideoCommand ? null : detectMediaGenerationIntent(text);

  if (isExplicitImageCommand || mediaIntent === "image") {
    // OUR OWN image-generation model (council.generate_image), self-
    // hosted on our own ModelScope Studio — not a third-party API call.
    // Either the explicit command, or natural-language intent (see
    // detectMediaGenerationIntent above) — the full sentence is used as
    // the prompt either way for the natural-language path, since a
    // text-to-image model handles a full descriptive sentence fine
    // without needing the trigger phrase stripped out of it first.
    //
    // Owner spec, 2026-09-09: async now, like /فيديو below — real
    // evidence (Render logs) that Hugging Face's free tier refuses to
    // serve our own image model moved this to our own CPU-only
    // ModelScope Studio, where inference is genuinely slow. The old
    // synchronous, wait-for-the-photo-inline design only worked while
    // this was calling a third party's own (fast) infrastructure.
    const prompt = isExplicitImageCommand ? text.replace(/^\/(صورة|image)\s*/, "").trim() : text;
    if (!prompt) {
      await bot.api.sendMessage(chatId, "أرسل الأمر متبوعاً بوصف الصورة، مثال:\n/صورة قطة سوداء تحت المطر");
      return;
    }
    await bot.api.sendMessage(chatId, "🖼 جارٍ توليد الصورة — قد يستغرق الأمر بضع دقائق، ستصلك هنا فور الانتهاء.").catch(() => null);
    const { ok: genOk, data: genData } = await callNovaBackend("/generate-image", {
      channel: "TELEGRAM",
      telegram_id: tgUserId,
      chat_id: String(chatId),
      prompt,
    });
    if (!genOk) {
      await bot.api.sendMessage(chatId, genData?.detail || "تعذر جدولة توليد الصورة — حاول مرة أخرى.");
    }
    return;
  }

  if (isExplicitVideoCommand || mediaIntent === "video") {
    // OUR OWN video-generation model (council.generate_video /
    // HF_VIDEO_MODEL_ID — see ai-system/colab/generate_image_model.ipynb's
    // video-gen cells). Unlike /صورة above, this is async (like /image
    // and /chat) — real video-generation latency is unmeasured and
    // could easily exceed this route's own timeout, so the backend
    // pushes the finished video straight to Telegram once ready
    // instead of waiting for it inline here. Either the explicit
    // command, or natural-language intent — see the image block above
    // for why the full sentence is used as-is for that path.
    const prompt = isExplicitVideoCommand ? text.replace(/^\/(فيديو|video)\s*/, "").trim() : text;
    if (!prompt) {
      await bot.api.sendMessage(chatId, "أرسل الأمر متبوعاً بوصف الفيديو، مثال:\n/فيديو قطة تلعب بكرة صوف");
      return;
    }
    await bot.api.sendMessage(chatId, "🎬 جارٍ توليد الفيديو — قد يستغرق الأمر عدة دقائق، سيصلك هنا فور الانتهاء.").catch(() => null);
    const { ok: videoOk, data: videoData } = await callNovaBackend("/generate-video", {
      channel: "TELEGRAM",
      telegram_id: tgUserId,
      chat_id: String(chatId),
      prompt,
    });
    if (!videoOk) {
      await bot.api.sendMessage(chatId, videoData?.detail || "تعذر جدولة توليد الفيديو — حاول مرة أخرى.");
    }
    return;
  }

  await bot.api.sendChatAction(chatId, "typing").catch(() => null);

  // Owner report, 2026-09-08: real Render log evidence — the
  // self-critique response format (ModelScope app.py's <تفكير>/<اجابة>
  // tags, added the same day) pushed real text generation to 70-95s+
  // per answer, past both this route's own 55s abort and Vercel's 60s
  // maxDuration (confirmed live: every message failed with "تعذر
  // الاتصال" even though the model was still working). Same fix as
  // /image: don't wait for the answer inline, just schedule it —
  // ai-system/app/main.py's /chat delivers it straight to Telegram
  // once ready.
  await bot.api.sendMessage(chatId, "🤔 جارٍ التفكير في إجابتك...").catch(() => null);
  const { ok, data } = await callNovaBackend("/chat", { channel: "TELEGRAM", telegram_id: tgUserId, chat_id: String(chatId), message: text });
  if (!ok) {
    await bot.api.sendMessage(chatId, data?.detail || "حدث خطأ — حاول مرة أخرى بعد قليل.");
  }
}

async function handleVoiceMessage(bot: TelegramBot, chatId: number, tgUserId: string, fileId: string) {
  await bot.api.sendChatAction(chatId, "typing").catch(() => null);
  const audioBase64 = await downloadTelegramFileAsBase64(bot, fileId);
  if (!audioBase64) {
    await bot.api.sendMessage(chatId, "تعذّر تحميل الرسالة الصوتية — حاول مرة أخرى.");
    return;
  }
  await bot.api.sendMessage(chatId, "🤔 جارٍ الاستماع والتفكير في إجابتك...").catch(() => null);
  const { ok, data } = await callNovaBackend("/voice", {
    channel: "TELEGRAM",
    telegram_id: tgUserId,
    chat_id: String(chatId),
    audio_base64: audioBase64,
    filename: "voice.ogg",
  });
  if (!ok) {
    await bot.api.sendMessage(chatId, data?.detail || "حدث خطأ في معالجة الصوت — حاول مرة أخرى.");
  }
}

async function handleImageMessage(bot: TelegramBot, chatId: number, tgUserId: string, fileId: string, caption?: string) {
  await bot.api.sendChatAction(chatId, "typing").catch(() => null);
  const imageBase64 = await downloadTelegramFileAsBase64(bot, fileId);
  if (!imageBase64) {
    await bot.api.sendMessage(chatId, "تعذّر تحميل الصورة — حاول مرة أخرى.");
    return;
  }
  // Owner report, 2026-09-07: real vision inference on the free
  // ModelScope box (CPU-only) measured ~4-5 minutes for one photo —
  // far past this route's own 55s abort / Vercel's 60s maxDuration, so
  // /image no longer waits for the actual answer inline (confirmed
  // live: that used to fail here with the generic "تعذر الاتصال"
  // message even though the model was still working). The backend now
  // only schedules the work and answers Telegram directly once done
  // (see ai-system/app/main.py's /image handler) — this call just has
  // to succeed at *scheduling* it, which is fast.
  await bot.api
    .sendMessage(chatId, "🖼 جارٍ تحليل الصورة بدقة — قد يستغرق الأمر بضع دقائق، سيصلك الرد هنا فور الانتهاء.")
    .catch(() => null);
  const { ok, data } = await callNovaBackend("/image", {
    channel: "TELEGRAM",
    telegram_id: tgUserId,
    chat_id: String(chatId),
    image_base64: imageBase64,
    caption: caption || null,
  });
  if (!ok) {
    await bot.api.sendMessage(chatId, data?.detail || "حدث خطأ في تحليل الصورة — حاول مرة أخرى.");
  }
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
  await bot.api.sendMessage(chatId, "🤔 جارٍ قراءة الملف والتفكير في إجابتك...").catch(() => null);
  const { ok, data } = await callNovaBackend("/file", {
    channel: "TELEGRAM",
    telegram_id: tgUserId,
    chat_id: String(chatId),
    file_base64: fileBase64,
    filename: fileName || "file.txt",
    question: caption || null,
  });
  if (!ok) {
    await bot.api.sendMessage(chatId, data?.detail || "حدث خطأ في قراءة الملف — حاول مرة أخرى.");
  }
}
