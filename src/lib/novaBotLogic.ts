import { Bot as TelegramBot, InlineKeyboard, InputFile, Keyboard } from "grammy";
import { refreshPressure, pressureOn } from "@/lib/pressureMode";
import type { ShamStepEvent } from "@/lib/shamAgent";
import { openCard as openMsgCard, cardPhase, cardTool, cardStepDone, cardFinish, cardSay, cardDrop, cardRestore, cardRender, cardSnapshot, type Card } from "@/lib/singleMessage";
import { stepLabel, understandingPrompt } from "@/lib/agentCard";
import type { Bot as BotRow } from "@prisma/client";
import { SITE_URL } from "@/lib/siteUrl";
import { isAdVerifyPayload, consumeAdVerifyPayload } from "@/lib/adVerifyPayload";
import { formatBroadcastText } from "@/lib/utils";
import { NOVA_LEGACY_BACKEND_PAUSED, NOVA_LEGACY_PAUSED_TEXT } from "@/lib/novaPause";
import { looksLikeToolPlan } from "@/lib/coderMediaFast";
import { shamGenerate, shamGenerateAny, shamChatAuto, shamChatMemory, shamGenerateMedia, shamStudioEnabled, shamThink, shamThinkPatient, shamReplyTokens, shamThinkUnavailable, shamJobResult, shamStatusText, shamPendingText, type ShamReply } from "@/lib/shamStudio";
import { chatKey, type loadMemory } from "@/lib/shamMemory";
import { loadChatMemory, saveChatTurn } from "@/lib/shamThreads";
import { shamAgentOn, shamAgentRun, shamToolCtx, shamToolDefs } from "@/lib/shamAgent";
import { shamClaimUpdate, shamConfirmText, shamRunTool, shamSavePending, shamSaveRun, shamTakePending, shamTakeRun } from "@/lib/shamExec";
import { later } from "@/lib/coderRuntime";
import { taskEvent, taskStart, taskStatus } from "@/lib/coderTasks";
import { selfUrl, signContinue } from "@/lib/coderSections";
import { shamLastFailure, shamModeCtx, shamVariant } from "@/lib/shamStudio";
import { coderChatKey, prismaDb, tierFor } from "@/lib/coderAuth";

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
// Owner spec, 2026-09-09: "توليد صورة"/"توليد فيديو" as dedicated
// buttons are gone — the free-text AI understanding built into /chat
// (council.classify_intent) already covers that without a button ("لا
// داعي للزرين الحاليين"). "🎬 الاستوديو" replaces them with real,
// non-AI tools instead: editing the user's OWN photos (crop/resize)
// and the site's already-working free tools, both wired below.
function novaMainMenu(): Keyboard {
  // Owner spec, 2026-09-09 ("لاحظ زر سجل المحادثات لا يزال متاح
  // للمستخدم يجب إزالته وجعله متاح فقط للأدمن"): a regular customer's
  // own history was never really the point of this button — it's now
  // admin-only (see novaAdminMenu below), so it's gone from here.
  return new Keyboard()
    .text("🎬 الاستوديو").row()
    .text("🎛 لوحتي").text("💎 ترقية").row()
    .text("🔗 ربط حساباتي")
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

const USAGE_LOGS_PAGE_SIZE = 5;

// Owner spec, 2026-09-09: "📜 سجل المحادثات" is now admin-only and must
// show the ENTIRE log across every user, paginated with a numbered
// "التالي" button — not one person's own last 5 like the old
// /whoami+recentLogs path (see quota.py's list_usage_logs docstring).
// Shared by both the initial text command and the "nova_log_page|"
// callback below so the page-turning re-render can't drift from the
// first render.
async function renderUsageLogsPage(offset: number): Promise<{ text: string; keyboard: InlineKeyboard }> {
  const { ok, data } = await callNovaBackend("/admin/usage-logs", { offset, limit: USAGE_LOGS_PAGE_SIZE });
  if (!ok) {
    return { text: `تعذر جلب السجل: ${data?.detail || "خطأ غير معروف"}`, keyboard: new InlineKeyboard() };
  }
  const logs = (data.logs || []) as any[];
  const total = Number(data.total || 0);
  if (logs.length === 0) {
    return { text: "لا توجد محادثات مسجّلة في هذا النطاق.", keyboard: new InlineKeyboard() };
  }
  const totalPages = Math.max(1, Math.ceil(total / USAGE_LOGS_PAGE_SIZE));
  const currentPage = Math.floor(offset / USAGE_LOGS_PAGE_SIZE) + 1;
  const lines = logs
    .map(
      (l, i) =>
        `${offset + i + 1}. [${l.userLabel}] ${new Date(l.created_at).toLocaleString("ar")}\nس: ${(l.message || "").slice(0, 150)}\nج: ${(l.answer || "").slice(0, 200)}`
    )
    .join("\n\n---\n\n");
  const text = `📜 سجل المحادثات — صفحة ${currentPage} من ${totalPages} (الإجمالي: ${total})\n\n${lines}`;
  const kb = new InlineKeyboard();
  if (offset > 0) kb.text("⏮ السابق", `nova_log_page|${Math.max(0, offset - USAGE_LOGS_PAGE_SIZE)}`);
  if (offset + USAGE_LOGS_PAGE_SIZE < total) kb.text("التالي ⏭", `nova_log_page|${offset + USAGE_LOGS_PAGE_SIZE}`);
  return { text, keyboard: kb };
}

// follow-up stays a typed command like every other admin-only text
// command here (/لوحتي, /ترقية, /صورة).
// Owner report, 2026-09-09 (real complaint): "لماذا السجل ليس في
// حسابي كأدمن؟!" — the admin's /start always routes to
// sendNovaAdminPanel (never the customer welcome), which only ever
// attached this menu — so the owner had no button for "🎬 الاستوديو"،
// "🎛 لوحتي"، or "📜 سجل المحادثات" at all, even though the underlying
// text handlers for all three were never admin-restricted (the owner
// is a real Nova user too, not just its operator). Added here so the
// owner gets every customer feature plus the admin-only commands, in
// one menu, instead of two disconnected ones.
function novaAdminMenu(): Keyboard {
  return new Keyboard()
    .text("🎬 الاستوديو").text("🎛 لوحتي").row()
    .text("📜 سجل المحادثات").text("🔑 مفتاح API").row()
    .text("🔗 ربط حساباتي").text("⏳ طلبات الاشتراك المعلّقة").row()
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
  const [action, param] = String(cq.data || "").split("|");

  if (action === "nova_log_page") {
    const { text, keyboard } = await renderUsageLogsPage(Number(param) || 0);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    await bot.api.editMessageText(chatId, messageId, text, { reply_markup: keyboard }).catch(() => null);
    return;
  }

  if (action !== "nova_sub_approve" && action !== "nova_sub_reject") {
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }

  const subId = param;
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

// Owner correction, 2026-09-09 ("ليس هدفنا البوت — البوت مجرد حاوية
// اختبار حالية... اذا وضعنا اوامر اجبارية لاجل تنظيم الرد بالبوت
// بالمستقبل سنصنع تطبيق وموقع ويب للذكاء فحينها سيكون مبرمج على
// الاجبار وليس الذكاء المعرفي كما تتحدث انت معي الآن"): this file used
// to guess image/video intent itself with a keyword verb+noun list
// (detectMediaGenerationIntent, removed here) and briefly patched a
// real gap in that list with a Telegram force_reply trick (real bug:
// "قطة سوداء تحت المطر" has no generation verb, so it fell through to
// plain chat and got answered with a text description of a cat
// instead of an actual image). Both were mechanical, client-side
// pattern-matching — exactly the kind of "force" the owner is warning
// against baking into the eventual real app/website this bot is only
// a testing container for.
//
// The fix: this thin client no longer decides intent at all, finally
// matching its own module docstring above ("owns zero AI logic").
// Every plain message — a bare description with no verb included —
// now goes straight to /chat, and OUR OWN model on the backend
// (council.classify_intent, using real conversation memory the same
// way a person would) decides whether it's an image/video request and
// produces the generation prompt itself. See ai-system/app/main.py's
// _process_chat_and_deliver and ai-system/app/council.py's
// classify_intent for where that now lives.

// Owner spec, 2026-09-08 ("قسم في لوحة المستخدم... وظائف مجاني ومدفوع
// ونربطها بادوات حقيقية تعمل على موقعنا... حالياً كله مجاني حتى يكتمل
// البناء"): wires the bot to the SAME free-tools API routes the
// website already serves (src/app/api/free-tools/*) — real, already-
// working endpoints, not new AI logic. All free for now per that spec;
// gating a mode behind a paid plan later is a one-line change here
// (check the user's plan the same way _enforce_quota does on the
// Python side) once the owner decides which ones become paid.
//
// Owner spec, 2026-09-09 ("زر ادوات الموقع يجب اضافته محتواه كاداة
// واحدة للزر ادوات وحاسبات"): these 2 entries no longer have their own
// top-level "🧰 أدوات الموقع" menu — studioCalcMenu() below lists them
// directly alongside STUDIO_CALC_TOOLS's 6 calculators, one flat list.
const STUDIO_TOOLS: Record<string, { label: string; endpoint: string; modes: Record<string, string> }> = {
  writing: {
    label: "✍️ كاتب المحتوى",
    endpoint: "/api/free-tools/writing-assistant",
    modes: {
      caption: "منشور تسويقي",
      blog: "مسودة مقال",
      "product-desc": "وصف منتج",
      translate: "ترجمة",
    },
  },
  analyzer: {
    label: "📊 محلل النصوص",
    endpoint: "/api/free-tools/text-analyzer",
    modes: {
      summarize: "تلخيص تقرير",
      reviews: "تحليل آراء عملاء",
    },
  },
};

// Owner spec, 2026-09-09 ("قم بعمل جول على كل ادوات الموقع... قسم
// مستقل"): a real audit of every standalone tool on the site (bot
// templates excluded, per that same request) found 6 real, already-
// working tools whose logic is simple enough to reuse directly here —
// 2 already have their own API route (business-name, url-shorten), the
// other 4 (zakat/margin/vat/crypto) are pure client-side math/API calls
// in their own page components, ported here verbatim (same formulas,
// same CoinGecko call) rather than duplicated behind a new route. A
// genuinely separate section from STUDIO_TOOLS above (which are AI
// calls) — none of these touch the AI at all.
type CalcToolResult = { text: string } | { error: string };

const STUDIO_CALC_TOOLS: Record<
  string,
  { label: string; instructions: string; handle: (input: string) => Promise<CalcToolResult> }
> = {
  "business-name": {
    label: "🏷 مولّد أسماء المشاريع",
    instructions: "🏷 أرسل الآن وصفاً قصيراً لمشروعك/متجرك — [مولّد أسماء المشاريع]",
    handle: async (input) => {
      try {
        const res = await fetch(`${SITE_URL}/api/free-tools/business-name`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: input }),
          signal: AbortSignal.timeout(30000),
        });
        const data = await res.json().catch(() => ({}));
        return res.ok && data.output ? { text: data.output } : { error: data?.error || "تعذّر توليد الأسماء الآن." };
      } catch {
        return { error: "تعذّر الاتصال بالأداة — حاول لاحقاً." };
      }
    },
  },
  "url-shorten": {
    label: "🔗 مختصر الروابط",
    instructions: "🔗 أرسل الآن الرابط الذي تريد اختصاره — [مختصر الروابط]",
    handle: async (input) => {
      try {
        const res = await fetch(`${SITE_URL}/api/tools/shorten`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: input.trim() }),
          signal: AbortSignal.timeout(15000),
        });
        const data = await res.json().catch(() => ({}));
        return res.ok && data.shortUrl
          ? { text: `🔗 الرابط المختصر: ${data.shortUrl}` }
          : { error: data?.error || "تعذّر اختصار الرابط." };
      } catch {
        return { error: "تعذّر الاتصال بالأداة — حاول لاحقاً." };
      }
    },
  },
  // Simplified vs. the full site page (src/app/free-tools/zakat-calculator):
  // that page separately weighs gold/silver by grams+price and compares
  // against a nisab threshold; collecting that many fields one-by-one in
  // chat would be real friction for little gain, so this asks for the
  // already-netted zakatable total directly and applies the same 2.5%
  // rate (ZAKAT_RATE in that page) — stated as a simplification, not
  // silently dropped precision.
  zakat: {
    label: "🕌 حاسبة الزكاة",
    instructions:
      "🕌 أرسل صافي أموالك الزكوية بعد خصم الديون (نقد + قيمة ذهب/فضة + أسهم) كرقم واحد — [حاسبة الزكاة]\nمثال: 20000",
    handle: async (input) => {
      const net = parseFloat(input.replace(/,/g, "").replace(/[^0-9.-]/g, ""));
      if (!isFinite(net) || net <= 0) return { error: "أرسل رقماً صحيحاً أكبر من صفر، مثال: 20000" };
      const zakat = net * 0.025;
      return {
        text:
          `🕌 (بافتراض بلوغ النصاب)\nصافي المال: ${net.toLocaleString("ar")}\nالزكاة (2.5%): ${zakat.toLocaleString("ar", { maximumFractionDigits: 2 })}\n\n` +
          "⚠️ حساب مبسّط — للتفاصيل الكاملة (نصاب الذهب/الفضة بالوزن) استخدم حاسبة الزكاة الكاملة على الموقع.",
      };
    },
  },
  margin: {
    label: "📈 حاسبة هامش الربح",
    instructions: "📈 أرسل التكلفة والسعر مفصولين بمسافة — [حاسبة هامش الربح]\nمثال: 50 100",
    handle: async (input) => {
      const [cost, price] = input.trim().split(/\s+/).map(Number);
      if (!isFinite(cost) || !isFinite(price) || price <= 0) {
        return { error: "أرسل رقمين: التكلفة ثم السعر، مثال: 50 100" };
      }
      const unitProfit = price - cost;
      const marginPct = (unitProfit / price) * 100;
      const markupPct = cost > 0 ? (unitProfit / cost) * 100 : 0;
      return {
        text: `📈 ربح الوحدة: ${unitProfit.toFixed(2)}\nهامش الربح (Margin): ${marginPct.toFixed(1)}%\nنسبة الزيادة (Markup): ${markupPct.toFixed(1)}%`,
      };
    },
  },
  vat: {
    label: "🧾 حاسبة الضريبة (VAT)",
    instructions: "🧾 أرسل المبلغ ونسبة الضريبة مفصولين بمسافة (النسبة اختيارية، افتراضي 15%) — [حاسبة الضريبة]\nمثال: 100 15",
    handle: async (input) => {
      const parts = input.trim().split(/\s+/).map(Number);
      const amount = parts[0];
      const rate = isFinite(parts[1]) ? parts[1] : 15;
      if (!isFinite(amount) || amount < 0 || rate < 0) return { error: "أرسل رقماً صحيحاً للمبلغ، مثال: 100 15" };
      const r = rate / 100;
      const vatExclusive = amount * r;
      const baseFromInclusive = amount / (1 + r);
      return {
        text:
          `🧾 إن كان ${amount} قبل الضريبة (${rate}%): الضريبة ${vatExclusive.toFixed(2)}، الإجمالي ${(amount + vatExclusive).toFixed(2)}\n` +
          `إن كان ${amount} شاملاً الضريبة: الأساس ${baseFromInclusive.toFixed(2)}، الضريبة ضمنه ${(amount - baseFromInclusive).toFixed(2)}`,
      };
    },
  },
  // Same CoinGecko endpoint/coin-id mapping as
  // src/app/free-tools/crypto-converter/CryptoConverter.tsx, ported
  // server-side instead of duplicating a client widget in a bot chat.
  crypto: {
    label: "💱 محوّل العملات الرقمية",
    instructions:
      "💱 أرسل: المبلغ ثم العملة المصدر ثم الهدف (TON, BTC, ETH, USDT, USD, SAR) — [محوّل العملات]\nمثال: 10 USDT SAR",
    handle: async (input) => {
      const parts = input.trim().split(/\s+/);
      const amount = Number(parts[0]);
      const from = (parts[1] || "").toUpperCase();
      const to = (parts[2] || "").toUpperCase();
      const COIN_IDS: Record<string, string> = { TON: "the-open-network", BTC: "bitcoin", ETH: "ethereum", USDT: "tether" };
      if (!isFinite(amount) || amount <= 0 || !from || !to) {
        return { error: "الصيغة: المبلغ ثم العملة المصدر ثم الهدف، مثال: 10 USDT SAR" };
      }
      if (from === to) return { text: `${amount} ${from} = ${amount} ${to}` };
      try {
        const res = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${Object.values(COIN_IDS).join(",")}&vs_currencies=usd,sar`,
          { signal: AbortSignal.timeout(15000) }
        );
        const prices = await res.json();
        // Any coin's own usd/sar pair gives the same USD/SAR rate — try
        // each until one actually has both fields (a single missing
        // coin from CoinGecko's response shouldn't sink the whole SAR
        // conversion).
        const anyCoin = Object.values(COIN_IDS).find((id) => prices[id]?.usd && prices[id]?.sar);
        const sarPerUsd = anyCoin ? prices[anyCoin].sar / prices[anyCoin].usd : null;

        const toUsd = (code: string, amt: number): number | null => {
          if (code === "USD") return amt;
          if (code === "SAR") return sarPerUsd ? amt / sarPerUsd : null;
          const id = COIN_IDS[code];
          return id && prices[id]?.usd ? amt * prices[id].usd : null;
        };
        const usdAmount = toUsd(from, amount);
        if (usdAmount === null) return { error: "تعذّر جلب سعر العملة المطلوبة." };

        let result: number | null;
        if (to === "USD") result = usdAmount;
        else if (to === "SAR") result = sarPerUsd ? usdAmount * sarPerUsd : null;
        else result = COIN_IDS[to] && prices[COIN_IDS[to]]?.usd ? usdAmount / prices[COIN_IDS[to]].usd : null;

        if (result === null || !isFinite(result)) return { error: "تعذّر إتمام التحويل — تأكد من رموز العملات." };
        return { text: `💱 ${amount} ${from} ≈ ${result.toLocaleString("en", { maximumFractionDigits: 6 })} ${to}` };
      } catch {
        return { error: "تعذّر الاتصال بخدمة الأسعار — حاول لاحقاً." };
      }
    },
  },
};

// Owner spec, 2026-09-09 ("يجب ان تظهر الازرار في لوحة القائمة وليس في
// المحادثة تذكر ان هذا شرط منذ بداية عملنا معا"): every Studio menu
// below was an InlineKeyboard — attached to one message, scrolling away
// into chat history like any other bubble. Converted the whole Studio
// navigation to persistent reply Keyboards (the same docked-panel
// pattern novaMainMenu/novaAdminMenu already use), matched by exact
// button text like every other command in this file, instead of
// callback_data. Each "🔙" back button gets its own distinct label
// (rather than one generic "رجوع") specifically so a flat text match
// can route it correctly with no server-side navigation state to keep —
// this file's existing stateless-thin-client design, just extended one
// level deeper.
//
// Owner spec, same message ("بالنسبة لزر ادوات الموقع يجب اضافته
// محتواه كاداة واحدة للزر ادوات وحاسبات"): STUDIO_TOOLS (the 2 AI
// tools, formerly their own "🧰 أدوات الموقع" section) are now folded
// directly into this same combined list alongside the 6 calculators —
// one flat menu instead of two separate top-level sections.
function studioCalcMenu(): Keyboard {
  const kb = new Keyboard();
  const aiToolLabels = Object.values(STUDIO_TOOLS).map((t) => t.label);
  const calcLabels = Object.values(STUDIO_CALC_TOOLS).map((t) => t.label);
  const allLabels = [...aiToolLabels, ...calcLabels];
  for (let i = 0; i < allLabels.length; i += 2) {
    kb.text(allLabels[i]);
    if (allLabels[i + 1]) kb.text(allLabels[i + 1]);
    kb.row();
  }
  return kb.text("🔙 الاستوديو").resized();
}

function studioRootMenu(): Keyboard {
  return new Keyboard()
    .text("✋ المكتبة اليدوية (على صورك)").row()
    .text("🧮 أدوات وحاسبات").row()
    .text("🔙 القائمة الرئيسية")
    .resized();
}

function studioModesMenu(toolKey: string): Keyboard {
  const kb = new Keyboard();
  for (const label of Object.values(STUDIO_TOOLS[toolKey].modes)) {
    kb.text(label).row();
  }
  return kb.text("🔙 أدوات وحاسبات").resized();
}

// Same zero-server-state reasoning as the removed image/video
// force_reply trick (see the owner-correction comment above) — but
// legitimate here, unlike there: the user just tapped an exact button
// naming an exact deterministic operation, so there is no "intent" left
// to understand, only input left to collect. Encodes which tool+mode via
// the exact prompt text itself (matched back against msg.reply_to_message
// below) instead of any persisted session, consistent with this file's
// thin-client design.
function studioInputPromptText(toolKey: string, modeKey: string): string {
  const tool = STUDIO_TOOLS[toolKey];
  return `📝 أرسل النص الآن — [${tool.label}: ${tool.modes[modeKey]}]`;
}

function parseStudioInputPrompt(promptText: string): { toolKey: string; modeKey: string } | null {
  const match = promptText.match(/^📝 أرسل النص الآن — \[(.+?): (.+?)\]$/);
  if (!match) return null;
  const [, toolLabel, modeLabel] = match;
  for (const [toolKey, tool] of Object.entries(STUDIO_TOOLS)) {
    if (tool.label !== toolLabel) continue;
    for (const [modeKey, label] of Object.entries(tool.modes)) {
      if (label === modeLabel) return { toolKey, modeKey };
    }
  }
  return null;
}

function findStudioToolByLabel(label: string): string | null {
  for (const [toolKey, tool] of Object.entries(STUDIO_TOOLS)) {
    if (tool.label === label) return toolKey;
  }
  return null;
}

function findStudioModeByLabel(label: string): { toolKey: string; modeKey: string } | null {
  for (const [toolKey, tool] of Object.entries(STUDIO_TOOLS)) {
    for (const [modeKey, modeLabel] of Object.entries(tool.modes)) {
      if (modeLabel === label) return { toolKey, modeKey };
    }
  }
  return null;
}

// Owner spec, 2026-09-09 ("هدفي كان وصله بمحرر صور... من القص والتركيب
// الى اخره... وليست وظيفة" — the old caption-typing trick, "أرفق صورة
// واكتب قص", was easy to mistype and gave no feedback on failure):
// replaced with a real menu of 10 actual sharp operations (see
// src/app/api/nova/studio/image-edit/route.ts — each independently
// verified against a real image buffer before shipping), selected by
// tapping a button instead of remembering/typing an exact caption word.
// Multi-photo composition ("تركيب" — merging two images together) and
// any video editing are genuinely separate, larger features not built
// yet — stated plainly rather than implied by this menu, since every
// operation here takes exactly one photo.
const MANUAL_PHOTO_OPS: Record<string, string> = {
  "◻️ قص مربع": "crop-square",
  "📱 قص طولي": "crop-portrait",
  "🖥 قص عريض": "crop-landscape",
  "🔽 تصغير": "resize-small",
  "🔼 تكبير": "resize-large",
  "🔄 تدوير 90°": "rotate-90",
  "↔️ عكس أفقي": "flip-h",
  "↕️ عكس رأسي": "flip-v",
  "⚫ أبيض وأسود": "grayscale",
  "✨ زيادة الحدة": "sharpen",
};

function manualLibraryMenu(): Keyboard {
  const kb = new Keyboard();
  const labels = Object.keys(MANUAL_PHOTO_OPS);
  for (let i = 0; i < labels.length; i += 2) {
    kb.text(labels[i]);
    if (labels[i + 1]) kb.text(labels[i + 1]);
    kb.row();
  }
  return kb.text("🔙 الاستوديو").resized();
}

function manualPhotoPromptText(opLabel: string): string {
  return `📸 أرسل الصورة الآن — [${opLabel}]`;
}

function parseManualPhotoPrompt(promptText: string): string | null {
  const match = promptText.match(/^📸 أرسل الصورة الآن — \[(.+?)\]$/);
  if (!match) return null;
  return MANUAL_PHOTO_OPS[match[1]] || null;
}

async function handleManualPhotoOp(bot: TelegramBot, chatId: number, fileId: string, op: string) {
  await bot.api.sendChatAction(chatId, "upload_photo").catch(() => null);
  const imageBase64 = await downloadTelegramFileAsBase64(bot, fileId);
  if (!imageBase64) {
    await bot.api.sendMessage(chatId, "تعذّر تحميل الصورة — حاول مرة أخرى.", { reply_markup: manualLibraryMenu() });
    return;
  }
  try {
    const res = await fetch(`${SITE_URL}/api/nova/studio/image-edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op, image_base64: imageBase64 }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.image_base64) {
      await bot.api.sendMessage(chatId, data?.error || "تعذّر تعديل الصورة — حاول مرة أخرى.", { reply_markup: manualLibraryMenu() });
      return;
    }
    await bot.api.sendPhoto(chatId, new InputFile(Buffer.from(data.image_base64, "base64"), "edited.jpg"), {
      reply_markup: manualLibraryMenu(),
    });
  } catch {
    await bot.api.sendMessage(chatId, "تعذّر الاتصال بأداة تعديل الصور — حاول لاحقاً.", { reply_markup: manualLibraryMenu() });
  }
}

// Sham's answer as the Telegram message it is: words, a picture or a sound (from the model's own tokens). A notice is plain text; nothing is added or retouched.

export async function sendShamReply(bot: TelegramBot, chatId: number, reply: ShamReply | null) {
  if (!reply) {
    // REVIEW (2026-10-14): was always "⏳ شام يتهيأ الآن…" for ANY missing answer (timeout, error, old Studio). Now an honest status line.
    const why = tierFor(chatId) === "owner" && shamLastFailure() ? `\n\n🔧 للمالك: ${shamLastFailure()}` : "";
    await bot.api.sendMessage(chatId, `تعذّر الحصول على رد من شام الآن (انتهى الوقت أو تعذّر الاتصال). أعد المحاولة بعد قليل.${why}`).catch(() => null);
    return;
  }
  if (reply.type === "loading" || reply.type === "busy" || reply.type === "gone") {
    await bot.api.sendMessage(chatId, shamStatusText({ reply })).catch(() => null);
    return;
  }
  if (reply.type === "image" && reply.b64) {
    await bot.api.sendPhoto(chatId, new InputFile(Buffer.from(reply.b64, "base64"), "sham.png")).catch(() => null);
  } else if (reply.type === "audio" && reply.b64) {
    await bot.api.sendDocument(chatId, new InputFile(Buffer.from(reply.b64, "base64"), "sham.wav")).catch(() => null);
  } else if (reply.type === "video" && reply.b64) {
    // a short clip from the model's own image tokens (sham_studio_media, video/mp4); the caption is the Studio's own line
    await bot.api.sendVideo(chatId, new InputFile(Buffer.from(reply.b64, "base64"), "sham.mp4"), reply.text ? { caption: reply.text.slice(0, 1000) } : {}).catch(() => null);
  } else if (reply.text) {
    // a long answer arrives in several messages (Telegram allows ~4096 characters each) instead of being cut
    // (a report beyond ~24000 characters goes as a file: nothing is ever cut; chunks break at line ends and each stays under Telegram's 4096)
    const full = reply.text;
    if (full.length > 24000) await bot.api.sendDocument(chatId, new InputFile(Buffer.from(full, "utf8"), "report.txt")).catch(() => null);
    else for (let i = 0; i < full.length;) {
      let end = Math.min(full.length, i + 3800);
      if (end < full.length) { const nl = full.lastIndexOf("\n", end - 1); if (nl > i + 1500) end = nl + 1; }
      await bot.api.sendMessage(chatId, full.slice(i, end)).catch(() => null);
      i = end;
    }
  }
}

async function sendShamLater(bot: TelegramBot, chatId: number, later?: ShamReply[]) {
  for (const r of later || []) if (r && r.type !== "pending") await sendShamReply(bot, chatId, r);
}

// Sham's own agent round (src/lib/shamAgent.ts): the model may call its own tools (web, GitHub reading, memory, schedules), each call checked before it runs.
// true = handled. false = nothing usable came back in time: the caller continues with the one-step `think` path below.
/** The user's tap on a write Sham asked about: «نفّذ» runs it once (and only for the chat that was asked), «ألغِ» drops it. */
async function handleShamCallback(bot: TelegramBot, cq: any): Promise<void> {
  const [kind, id] = String(cq.data || "").split("|");
  const chatId = Number(cq.message?.chat?.id);
  const done = (text: string) => bot.api.answerCallbackQuery(cq.id, { text }).catch(() => null);
  const edit = (text: string) => bot.api.editMessageText(chatId, cq.message.message_id, text.slice(0, 3500)).catch(() => null);
  const call = chatId ? await shamTakePending(chatId, id || "") : null;
  if (!call) { await done("انتهت صلاحية هذا الطلب."); return; }
  if (kind === "shamno") { await done("أُلغي."); await edit("❌ ألغيتَ هذا الإجراء."); return; }
  await done("جارٍ التنفيذ…");
  const ctx = await shamToolCtx(chatId);
  const out = await shamRunTool(call, ctx, true);
  await edit(`${out.startsWith("error") ? "⚠️" : "✅"} ${out}`);
}

/** Sham's REAL agent events onto its card: thinking while a model call is in flight, each tool as it starts / ends (with its path / command), the queue when every Studio is busy. */
export function shamCardSteps(bot: TelegramBot, chatId: number, card: Card | null | undefined) {
  return (e: ShamStepEvent) => {
    if (e.type === "think") void cardPhase(bot, chatId, card, "think", "جاري التفكير");
    else if (e.type === "queue") void cardPhase(bot, chatId, card, "queue", e.text);
    else if (e.type === "tool_start") void cardTool(bot, chatId, card, stepLabel(e.name, e.args));
    else void cardStepDone(bot, chatId, card, e.ok);
  };
}
/** The model's own one-line understanding for the card: Sham's Studio, a tiny text-only call (28 tokens, 3.5 s cap). Skipped while the owner's pressure mode is on (that call would take a slot from real work). */
export function shamUnderstand(text: string): (() => Promise<string | null>) | undefined {
  if (pressureOn()) return undefined;
  return () => shamGenerate(understandingPrompt(text), 28, 3500);
}

const SHAM_LEGS = 6;                                   // a long task may use up to this many legs (each up to ~4 minutes in the background)

/** Sends what a leg produced. true = handled (an answer, a question, a picture, a confirmation, or the hand-over to the next leg). */
async function shamDeliver(bot: TelegramBot, chatId: number, r: Awaited<ReturnType<typeof shamAgentRun>>, request: string, botId: string | undefined, leg: number, runId?: string, card?: Card | null): Promise<boolean> {
  if (r.kind === "none") { await cardDrop(bot, chatId, card); if (runId) { await taskEvent(runId, "failed", "no answer from Sham in time").catch(() => null); await taskStatus(runId, "failed").catch(() => null); } return false; }
  if (r.kind === "more") {                              // the work goes on in the background: the shared runner calls the next leg (its own signed route)
    if (leg === 0) { if (!(await cardSay(bot, chatId, card, cardRender(card, ["⏳ أكمل العمل في الخلفية، وسأحدّث هذه الرسالة بالنتيجة حين أنتهي."])))) await bot.api.sendMessage(chatId, "⏳ أكمل العمل في الخلفية، وسأرسل النتيجة هنا حين أنتهي.").catch(() => null); }
    await shamSaveRun({ chatId, botId: botId || "", runId: runId || `sham-${chatId}-${Date.now().toString(36)}`, request, messages: r.messages, leg: leg + 1, variant: shamVariant.getStore() || "v1", card: card?.msgId ? cardSnapshot(card) : undefined, mode: (shamModeCtx.getStore() || {}) as Record<string, unknown> });
    const rid = runId || "";
    later(() => shamKickNextLeg(botId || "", chatId, rid, leg + 1));
    return true;
  }
  if (r.kind === "confirm") {                           // a write to the user's repository: ask first, run only on the tap
    if (runId) { await taskEvent(runId, "confirm", shamConfirmText(r.call)).catch(() => null); await taskStatus(runId, "waiting").catch(() => null); }
    const id = await shamSavePending(chatId, r.call);
    await cardDrop(bot, chatId, card);
    await bot.api.sendMessage(chatId, shamConfirmText(r.call), { reply_markup: new InlineKeyboard().text("✅ نفّذ", `shamok|${id}`).text("❌ ألغِ", `shamno|${id}`) }).catch(() => null);
    return true;
  }
  if (r.kind === "reply") {
    if (r.reply?.type === "text" && r.reply.text && card?.msgId) await cardFinish(bot, chatId, card, r.reply.text, (p) => bot.api.sendMessage(chatId, p).catch(() => null));
    else { await cardPhase(bot, chatId, card, "send", "جاري الإرسال"); await cardDrop(bot, chatId, card); await sendShamReply(bot, chatId, r.reply); }          // media goes as its own message; the card has nothing to say any more
    return true;
  }
  let out = r.kind === "ask" ? r.question : r.text;
  if (r.kind !== "ask" && looksLikeToolPlan(out)) {              // a tool plan written as the answer ("… ← sandbox_exec ثم sandbox_write_file") is not an answer: say so honestly
    if (runId) { await taskEvent(runId, "failed", `the model wrote a tool plan as its answer: ${out.slice(0, 160)}`).catch(() => null); await taskStatus(runId, "failed", r.steps).catch(() => null); }
    const planMsg = "تعذّر تنفيذ هذا الطلب: لم أستطع تشغيل الأداة المناسبة لإنجازه. أعد صياغته بجملة أوضح أو جرّب بعد قليل.";
    if (!(await cardSay(bot, chatId, card, planMsg))) await bot.api.sendMessage(chatId, planMsg).catch(() => null);
    return true;
  }
  if (runId) { await taskEvent(runId, "text", out).catch(() => null); await taskEvent(runId, "done", "").catch(() => null); await taskStatus(runId, "done", r.steps).catch(() => null); }
  if (card?.msgId && out.trim() && out.length <= 24000) await cardFinish(bot, chatId, card, out, (p) => bot.api.sendMessage(chatId, p).catch(() => null));   // the answer takes the card's place: one message
  else { await cardDrop(bot, chatId, card); await sendShamReply(bot, chatId, { type: "text", text: out }); }
  await saveChatTurn(chatId, request, out);
  return true;
}

async function shamKickNextLeg(botId: string, chatId: number, runId: string, leg: number): Promise<void> {
  const { prisma } = await import("@/lib/prisma");
  const row = await prisma.bot.findUnique({ where: { id: botId } }).catch(() => null);
  if (!row) return;
  const chain = `sham${leg}`;
  const who = `${chatId}#${runId}`;                      // the signed address names the chat AND the task: tasks of one chat run side by side
  const body = JSON.stringify({ botId, chatId: who, chain, sig: signContinue(row.webhookSecret || "", botId, who, chain) });
  await fetch(`${selfUrl()}/api/sham/continue`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(5000), cache: "no-store" }).catch(() => null);
}

/** The next leg of a long Sham task (called by /api/sham/continue, up to 300 s): the saved conversation goes on from where it stopped. */
export async function continueShamRun(bot: TelegramBot, chatId: number, botId: string, runId: string): Promise<void> {
  const run = await shamTakeRun(chatId, runId);
  if (!run) return;
  await shamVariant.run(run.variant, () => shamModeCtx.run(run.mode as never, async () => {
    const ctx = await shamToolCtx(chatId, botId);
    ctx.sendFile = async (name, bytes, caption) => { await bot.api.sendDocument(chatId, new InputFile(bytes, name), caption ? { caption } : {}); };      // send_file: a file from Sham's own VM goes to this chat
    await bot.api.sendChatAction(chatId, "typing").catch(() => null);
    const last = run.leg >= SHAM_LEGS;
    const card: Card | null = run.card?.msgId ? cardRestore(run.card) : null;
    const onEvent = run.runId ? (k: "tool" | "info" | "text", t: string) => { void taskEvent(run.runId!, k, t).catch(() => null); } : undefined;
    const r = await shamAgentRun({ text: run.request, resume: run.messages as never, onEvent, onStep: shamCardSteps(bot, chatId, card), queueNote: (n) => shamQueueNote(run.runId || "", n), ctx, tools: shamToolDefs(Boolean(ctx.githubToken), Boolean(ctx.connectors?.length)), budgetMs: 230000, askMs: 150000, maxSteps: 10, maxNew: shamReplyTokens(), mode: shamModeCtx.getStore(), continuable: !last });
    if (!(await shamDeliver(bot, chatId, r, run.request, botId, run.leg, run.runId, card))) {
      const why = tierFor(chatId) === "owner" && shamLastFailure() ? `\n\n🔧 للمالك: ${shamLastFailure()}` : "";
      await bot.api.sendMessage(chatId, `تعذّر إكمال المهمة الآن (لم يجب شام في الوقت). أعد إرسال طلبك.${why}`).catch(() => null);
    }
  }));
}

// Sham's own agent round (src/lib/shamAgent.ts): the model may call its own tools (web, GitHub, memory, schedules, its own computer), each call checked before it runs.
// true = handled. false = nothing usable came back in time: the caller continues with the one-step `think` path below.
/**
 * Sham / Sham v2: an explicit "generate a picture / a video of X" goes to the media route chosen in the owner's panel (Sham v2's own Studios) BEFORE the model:
 * 2026-10-28 the model answered "← sandbox_exec ثم sandbox_write_file" as text and nothing was made. The picture is sent alone (never the prompt as a caption).
 * true = handled; false = not such a request (the model's agent round runs as before).
 */
export async function shamMediaFastLane(bot: TelegramBot, chatId: number, text: string, botId?: string): Promise<boolean> {
  const mf = await import("@/lib/coderMediaFast");
  const intent = mf.detectMediaIntent(text);
  if (!intent) return false;
  await refreshPressure().catch(() => false);
  const runId = `sham-${chatId}-${Date.now().toString(36)}`;
  const card = await openMsgCard(bot, chatId, text, { understand: shamUnderstand(text) });      // one message: the model's understanding + real progress; a failure is written into it, a picture / video is sent separately
  await taskStart(chatId, { runId, slot: "sham", source: "interactive", title: text.slice(0, 120), botId }).catch(() => null);
  const fail = async (msg: string, detail = "") => {
    await taskEvent(runId, "failed", detail || msg).catch(() => null);
    await taskStatus(runId, "failed").catch(() => null);
    if (!(await cardSay(bot, chatId, card, msg.slice(0, 3500)))) await bot.api.sendMessage(chatId, msg.slice(0, 3500)).catch(() => null);
    await saveChatTurn(chatId, text, msg);
    return true;
  };
  try {
    await bot.api.sendChatAction(chatId, intent.kind === "video" ? "upload_video" : "upload_photo").catch(() => null);
    // the media models read English: a plain word list when it is enough, else Sham's own chat translates (no Nova call)
    let prompt = mf.glossaryPrompt(intent.subject);
    if (!prompt) {
      await cardTool(bot, chatId, card, "كتابة وصف إنجليزي للصورة");
      const t = await shamChatAuto(`Write ONE short English prompt (max 20 words) for an image model describing: ${intent.subject}. Output only the prompt.`, 40, 25000).catch(() => null);
      prompt = t?.type === "text" ? mf.cleanEnglishPrompt(t.text || "") : null;
      await cardStepDone(bot, chatId, card, Boolean(prompt));
    }
    if (!prompt) return await fail("تعذّر فهم وصف الصورة بما يكفي لإنشائها. اكتب الوصف بجملة أوضح (مثلاً: «حصان أبيض على شاطئ عند الغروب») وأعد المحاولة.", "no English prompt");
    await taskEvent(runId, "tool", `make_media ${intent.kind}: ${prompt}`).catch(() => null);
    const { generateShamMediaThroughRoute } = await import("@/lib/shamMediaRoutes");
    await cardTool(bot, chatId, card, stepLabel("make_media", { kind: intent.kind }));
    const reply = await generateShamMediaThroughRoute(intent.kind, prompt, { timeoutMs: intent.kind === "video" ? 240000 : 120000 });
    await cardStepDone(bot, chatId, card, Boolean(reply.type === intent.kind && reply.b64));
    if (reply.type === intent.kind && reply.b64) {
      await cardPhase(bot, chatId, card, "send", "جاري الإرسال");
      await cardDrop(bot, chatId, card);
      if (intent.kind === "image") await bot.api.sendPhoto(chatId, new InputFile(Buffer.from(reply.b64, "base64"), "sham.png"));
      else await bot.api.sendVideo(chatId, new InputFile(Buffer.from(reply.b64, "base64"), "sham.mp4"));
      await taskEvent(runId, "done", "").catch(() => null);
      await taskStatus(runId, "done", 1).catch(() => null);
      await saveChatTurn(chatId, text, intent.kind === "image" ? "🖼️ أُرسلت الصورة." : "🎬 أُرسل المقطع.");
      return true;
    }
    return await fail(`تعذّر إنشاء ${intent.kind === "image" ? "الصورة" : "المقطع"} هذه المرة. لم يُرسل شيء. أعد المحاولة بعد قليل.${tierFor(chatId) === "owner" && reply.text ? `\n\n🔧 للمالك: ${String(reply.text).slice(0, 300)}` : ""}`, String(reply.text || "failed"));
  } catch (e) {
    return await fail("تعذّر إنشاء الوسائط هذه المرة. أعد المحاولة بعد قليل.", String((e as Error)?.message || e).slice(0, 200));
  }
}

/** The queue line while Sham's Studios are on other people's work: the position among running Sham tasks and a time estimate (src/lib/queueInfo.ts). */
async function shamQueueNote(runId: string, attempt: number): Promise<string> {
  const { queueInfo, queueLine } = await import("@/lib/queueInfo");
  const { overflowBase } = await import("@/lib/shamPool");
  return queueLine(await queueInfo(runId, "sham", shamVariant.getStore() === "v2" && overflowBase() ? 2 : 1), attempt);
}

async function shamAgentAndSend(bot: TelegramBot, chatId: number, text: string, mem: Awaited<ReturnType<typeof loadMemory>>, botId?: string): Promise<boolean> {
  await refreshPressure().catch(() => false);
  const card = await openMsgCard(bot, chatId, text, { understand: shamUnderstand(text) });      // ONE message, within seconds: the model's own understanding line + real progress; the answer later takes its place
  await bot.api.sendChatAction(chatId, "typing").catch(() => null);
  const ctx = await shamToolCtx(chatId, botId);
  ctx.sendFile = async (name, bytes, caption) => { await bot.api.sendDocument(chatId, new InputFile(bytes, name), caption ? { caption } : {}); };      // send_file: a file from Sham's own VM goes to this chat
  await prismaDb.exec(`UPDATE coder_tasks SET status = 'stopped', finished_at = now() WHERE chat_key = $1 AND run_id LIKE 'sham-%' AND status IN ('running', 'waiting') AND updated_at < now() - interval '15 minutes'`, coderChatKey(chatId)).catch(() => null);      // only a task that has been silent for 15 minutes is closed; a live long task is left alone
  const runId = `sham-${chatId}-${Date.now().toString(36)}`;
  await taskStart(chatId, { runId, slot: "sham", source: "interactive", title: text.slice(0, 120), botId }).catch(() => null);      // the shared terminal shows Sham's work too
  const onEvent = (k: "tool" | "info" | "text", t: string) => { void taskEvent(runId, k, t).catch(() => null); };
  const r = await shamAgentRun({ text, history: mem?.history, onEvent, onStep: shamCardSteps(bot, chatId, card), queueNote: (n) => shamQueueNote(runId, n), ctx, tools: shamToolDefs(Boolean(ctx.githubToken), Boolean(ctx.connectors?.length)), budgetMs: 50000, askMs: 44000, maxNew: Math.min(shamReplyTokens(), 160), mode: shamModeCtx.getStore(), continuable: true });
  return shamDeliver(bot, chatId, r, text, botId, 0, runId, card);
}

/** Run the selected Sham model for a Mini App task; do not send this request to Nova. */
export async function runShamMiniAppTask(bot: TelegramBot, chatId: number, text: string, botId: string, runId: string, variant: "v1" | "v2", mode: Record<string, unknown>): Promise<void> {
  await shamVariant.run(variant, () => shamModeCtx.run(mode as never, async () => {
    try {
      if (!shamStudioEnabled()) throw new Error("Sham Studio is not configured (MODELSCOPE_API_TOKEN is missing).");
      const ctx = await shamToolCtx(chatId, botId);
      ctx.sendFile = async (name, bytes, caption) => { await bot.api.sendDocument(chatId, new InputFile(bytes, name), caption ? { caption } : {}); };
      const mem = await loadChatMemory(chatId, text);
      const onEvent = (k: "tool" | "info" | "text", t: string) => { void taskEvent(runId, k, t).catch(() => null); };
      const r = await shamAgentRun({ text, history: mem?.history, onEvent, onStep: () => undefined, queueNote: (n) => shamQueueNote(runId, n), ctx, tools: shamToolDefs(Boolean(ctx.githubToken), Boolean(ctx.connectors?.length)), budgetMs: 50000, askMs: 44000, maxNew: Math.min(shamReplyTokens(), 160), mode: shamModeCtx.getStore(), continuable: true });
      await shamDeliver(bot, chatId, r, text, botId, 0, runId, null);
    } catch (e) {
      const message = String((e as Error)?.message || e).slice(0, 300);
      await taskEvent(runId, "failed", message).catch(() => null);
      await taskStatus(runId, "failed").catch(() => null);
    }
  }));
}
// true = handled. false = this Studio has no `think` yet: the caller uses the older path (no dead "older version" reply to the user).
// The webhook has 60 s (maxDuration): think waits up to ~28 s on the Studio, then job_result is polled with short calls until ~50 s.
async function shamThinkAndSend(bot: TelegramBot, chatId: number, text: string, mem: Awaited<ReturnType<typeof loadMemory>>): Promise<boolean> {
  const t0 = Date.now();
  await bot.api.sendChatAction(chatId, "typing").catch(() => null);
  const first = await shamThinkPatient(text, mem?.chatKey || chatKey(chatId), mem, shamReplyTokens(), 28000, 40000);
  if (shamThinkUnavailable(first)) return false;
  const r = first.reply;
  let reasked = false;
  await sendShamLater(bot, chatId, r?.later);
  const done = async (x: ShamReply) => {
    await sendShamReply(bot, chatId, x);
    if (x.type === "text" && x.text) await saveChatTurn(chatId, text, x.text);
  };
  if (!r || r.type === "loading" || r.type === "busy" || r.type === "gone") {
    await bot.api.sendMessage(chatId, shamStatusText(first)).catch(() => null);
    return true;
  }
  if (r.type !== "pending" || !r.job) {
    await done(r);
    return true;
  }
  await bot.api.sendMessage(chatId, shamPendingText(r.decision)).catch(() => null);
  let job: string = r.job;
  while (Date.now() - t0 < 47000) {
    await new Promise((res) => setTimeout(res, 3000));
    const left = 50000 - (Date.now() - t0);
    if (left < 2000) break;
    await bot.api.sendChatAction(chatId, "typing").catch(() => null);
    const o = await shamJobResult(job, false, Math.min(8000, left));
    if (o.reply?.type === "gone" && !reasked && left > 20000) {
      // the Studio restarted and lost the job: the same message is asked again once (Nova does the same for a lost step) instead of asking the user to resend
      reasked = true;
      const again = await shamThink(text, mem?.chatKey || chatKey(chatId), mem, shamReplyTokens(), Math.min(25000, left - 4000));
      if (again.reply?.type === "pending" && again.reply.job) { job = again.reply.job; continue; }
      if (again.reply && again.reply.type !== "pending" && again.reply.type !== "gone") { await done(again.reply); return true; }
    }
    if (o.reply && o.reply.type !== "pending") {
      await done(o.reply.type === "gone" ? { type: "notice", text: shamStatusText(o) } : o.reply);
      return true;
    }
  }
  await shamJobResult(job, true, 4000);       // detach: the Studio hands it over with this user's next message
  await bot.api.sendMessage(chatId, "ما زال شام يعمل على ردّك — سيصلك مع رسالتك القادمة.").catch(() => null);
  return true;
}

export async function handleNovaBotUpdate(bot: TelegramBot, _botRow: BotRow, update: any) {
  // A call made inside shamVariant.run (the bot route always does) is a Sham chat: it takes Sham's path whatever the legacy-backend flag says (B-09).
  if (NOVA_LEGACY_BACKEND_PAUSED || shamVariant.getStore()) {
    if (update.callback_query?.id && /^sham(ok|no)\|/.test(String(update.callback_query.data || ""))) {
      await handleShamCallback(bot, update.callback_query);                  // the user's tap on a write Sham asked about
    } else if (update.callback_query?.id) {
      await bot.api.answerCallbackQuery(update.callback_query.id, { text: NOVA_LEGACY_PAUSED_TEXT, show_alert: true }).catch(() => null);
    } else if (update.message?.chat?.id) {
      // Nova's backend stays off, but this bot now speaks with Sham (the owner's own model on ModelScope) when the Studio is configured
      const text = typeof update.message.text === "string" ? update.message.text.trim() : "";
      const chatId = update.message.chat.id;
      const firstWord = text.split(/[\s@]/)[0].toLowerCase();
      // 2026-10-14: with SHAM_THINK on, a bare word («صورة …») is no longer a keyword rule — only the explicit slash command (/image, /صورة …)
      // is the user's own choice; everything else is for the model to decide. REVIEW: the bare-word form is kept for SHAM_THINK=0.
      const mediaKind = ((): "image" | "audio" | "video" | undefined => undefined)();     // 2026-10-17 (owner): no media commands at all — the model decides
      // with the Studio on, only /start, /help and the three media commands are commands; any other text starting with "/" is an ordinary message for Sham
      if ((text.startsWith("/") && (!shamStudioEnabled() || firstWord === "/start" || firstWord === "/help")) || mediaKind) {
        const welcome = "👋 أهلاً! أنا «شام»، نموذج ذكاء اصطناعي عربي قيد التدريب. اكتب لي سؤالك، وقد أجيب بكلام أو بصورة أو بصوت من عندي. ما زلت أتعلم، فقد لا يكون كلامي دقيقاً بعد.";
        const unavailable = "هذه الميزة غير متاحة الآن. اكتب جملة عادية وسأرد عليها.";
        const cmd = text.split(/[\s@]/)[0].toLowerCase();
        const kind = mediaKind;
        if (kind) {
          // the USER chose the kind; the picture / sound is written by the model's own tokens (sham_studio_media.make_media)
          const caption = text.slice(text.indexOf(" ") + 1).trim();
          if (!caption || caption === text) {
            await bot.api.sendMessage(chatId, "اكتب وصفك بعد الكلمة، مثلاً: صورة أرنب أبيض").catch(() => null);
            return;
          }
          await bot.api.sendChatAction(chatId, kind === "audio" ? "record_voice" : kind === "video" ? "upload_video" : "upload_photo").catch(() => null);
          // the route chosen in the owner's panel, on the variant that route belongs to; nothing is switched silently (the old direct call used the broken internal endpoint)
          const { generateShamMediaThroughRoute } = await import("@/lib/shamMediaRoutes");
          await sendShamReply(bot, chatId, await generateShamMediaThroughRoute(kind as "image" | "audio" | "video", caption));
          return;
        }
        await bot.api.sendMessage(chatId, cmd === "/start" || cmd === "/help" ? welcome : unavailable, { reply_markup: { remove_keyboard: true } }).catch(() => null);
        return;
      }
      if (text && shamStudioEnabled()) {
        // the MODEL decides whether its answer is words, a picture or a sound (sham_studio_media.generate_any); an older text-only Studio answers with plain text
        // plain message -> chat_auto (Studio-side intent routing), then generate_any for a Studio that has no chat_auto yet
        // the webhook has 60 s (maxDuration): the fallback only runs with the time chat_auto left (a fast "no such api" leaves nearly all of it)
        const t0 = Date.now();
        // the chat's recent turns + rolling summary + facts go with the message (chat_memory); an older Studio, or no database, falls back to chat_auto
        const mem = await loadChatMemory(chatId, text);
        // 2026-10-14 (owner): ONE model-decided step (Studio `think`): the model chooses reply / its own search / picture / sound / clip; no keyword
        // router, no fallback chain. A Studio without `think` yet (500 / unknown endpoint) falls through to the older path below at once.
        // REVIEW: the chat_memory / chat_auto / generate_any / generate_text chain below is superseded; kept for SHAM_THINK=0 and for old Studios.
        if (shamAgentOn()) {
          if (!(await shamClaimUpdate(chatId, update.update_id))) return;       // Telegram re-delivered this very message (same update id): it is already being handled
          // Telegram gets its answer at once and the work goes on in the background (as the coder does): a slow Studio can no longer make Telegram resend
          const variant = shamVariant.getStore() || "v1", mode = shamModeCtx.getStore() || {};
          later(() => shamVariant.run(variant, () => shamModeCtx.run(mode, async () => {
            if (await shamMediaFastLane(bot, chatId, text, _botRow?.id)) return;        // a clear "make a picture / video of X" request never waits for the model to choose a tool
            if (!(await shamAgentAndSend(bot, chatId, text, mem, _botRow?.id))) await sendShamReply(bot, chatId, null);
          })));
          return;
        }
        if (process.env.SHAM_THINK !== "0" && (await shamThinkAndSend(bot, chatId, text, mem))) return;
        let any = mem ? await shamChatMemory(text, { userId: mem.chatKey, history: mem.history, summary: mem.summary, facts: mem.facts }, 80, 45000) : null;
        if (!any) any = await shamChatAuto(text, 80, Math.max(5000, 48000 - (Date.now() - t0)));
        const left = 52000 - (Date.now() - t0);
        if (!any && left > 15000) any = await shamGenerateAny(text, 80, left);
        if (any) {
          await sendShamReply(bot, chatId, any);
          if (any.type === "text" && any.text) await saveChatTurn(chatId, text, any.text);
          return;
        }
        const reply = Date.now() - t0 < 40000 ? await shamGenerate(text, 80, Math.max(5000, 52000 - (Date.now() - t0))) : null;
        if (reply) {
          await saveChatTurn(chatId, text, reply);
          await bot.api.sendMessage(update.message.chat.id, reply.slice(0, 3500)).catch(() => null);
          return;
        }
        // the Studio did not answer in time (asleep or still loading): say so instead of Nova's pause notice
        // the "getting ready" line belongs to the OLD Sham only (its Studio sleeps); the new Sham gets the honest status line instead (owner's order, 2026-10-26)
        if (shamVariant.getStore() === "v2") await sendShamReply(bot, update.message.chat.id, null);
        else await bot.api.sendMessage(update.message.chat.id, "⏳ شام يتهيأ الآن. أعد إرسال رسالتك بعد دقيقة.").catch(() => null);
        return;
      }
      await bot.api.sendMessage(update.message.chat.id, NOVA_LEGACY_PAUSED_TEXT, { reply_markup: { remove_keyboard: true } }).catch(() => null);
    }
    return;
  }
  if (update.callback_query) {
    const cqData = String(update.callback_query.data || "");
    if (cqData.startsWith("shamok|") || cqData.startsWith("shamno|")) {
      await handleShamCallback(bot, update.callback_query);
    } else if (cqData.startsWith("nova_plan|")) {
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
    if (adminText === "📜 سجل المحادثات") {
      const { text, keyboard } = await renderUsageLogsPage(0);
      await bot.api.sendMessage(chatId, text, { reply_markup: keyboard });
      return;
    }
    // Owner spec, 2026-09-12 ("وضع المالك... عبر معرف تيليجرام + كلمة
    // سر أضيفها"): isAdmin above already confirms the Telegram ID
    // factor — this command supplies the second (password), checked
    // server-side (quota.py's verify_owner_password) since only that
    // side knows NOVA_OWNER_PASSWORD and can write ownerVerifiedAt.
    // One-time: after this succeeds, quota.is_platform_owner(user)
    // stays true for every future message from this same Telegram ID,
    // no need to repeat the password.
    if (adminText.startsWith("/تفعيل_المالك ")) {
      const password = adminText.slice("/تفعيل_المالك ".length).trim();
      const { ok, data } = await callNovaBackend("/admin/verify-owner-password", { telegram_id: tgUserId, password });
      // ok here is callNovaBackend's own HTTP-level success — the
      // endpoint itself always responds 200 with {ok, message} whether
      // verification succeeded or not, so data.message covers both
      // cases; data.detail only appears on a real HTTP-level failure
      // (network error, misconfigured secret) that never reached
      // quota.verify_owner_password at all.
      const message = ok ? data?.message || "خطأ غير معروف" : data?.detail || "تعذر الاتصال بخادم Nova AI.";
      await bot.api.sendMessage(chatId, message, { reply_markup: novaAdminMenu() });
      return;
    }
    // Owner spec, 2026-09-12 ("الادوات والتطوير الذاتي يعطيني تقرير...
    // فاقبل او ارفض"): the only two commands that ever move a
    // NovaSelfImprovementProposal off PENDING — self_improve.py's
    // decide_proposal does the real work (REJECTED just marks the row;
    // ACCEPTED with a confident file_path calls dev_agent's real PR
    // machinery). isAdmin above already gates this whole block to the
    // owner's own Telegram ID.
    if (adminText.startsWith("/موافقة_تطوير ") || adminText.startsWith("/رفض_تطوير ")) {
      const accept = adminText.startsWith("/موافقة_تطوير ");
      const prefix = accept ? "/موافقة_تطوير " : "/رفض_تطوير ";
      const proposalId = adminText.slice(prefix.length).trim();
      // chat_id lets the backend answer immediately and deliver the
      // real result later via a direct Telegram push once ACCEPTED
      // triggers a real (slow) code-change PR — see main.py's own
      // fix, 2026-09-13 ("تعذّر الاتصال بخادم Nova AI" was really this
      // 55s fetch timeout firing before a slow own-model call finished).
      const { ok, data } = await callNovaBackend("/admin/decide-self-improvement", {
        proposal_id: proposalId,
        accept,
        chat_id: String(chatId),
      });
      const message = ok ? data?.message || "خطأ غير معروف" : data?.detail || "تعذر الاتصال بخادم Nova AI.";
      await bot.api.sendMessage(chatId, message, { reply_markup: novaAdminMenu() });
      return;
    }
    // Owner spec, 2026-09-12 ("هل تستطيع تنفيذ هذا العمل الهندسي وانشاء
    // ملف جديد دون اخطاء... فان كان جوابه مقنعا اقول له نفذ ونعطيه
    // الصلاحية الكاملة"): for a proposal that needs a brand-new file
    // (not just editing an existing one) — /تحليل_تطوير asks Nova to
    // genuinely self-assess (self_improve.assess_feasibility, a real
    // model call, honest either way), /تنفيذ_تطوير is the owner's
    // explicit full-permission go-ahead after reading that analysis
    // (self_improve.implement_new_file — only works once an analysis
    // already stored a confident file path).
    if (adminText.startsWith("/تحليل_تطوير ") || adminText.startsWith("/تنفيذ_تطوير ")) {
      const isAssess = adminText.startsWith("/تحليل_تطوير ");
      const prefix = isAssess ? "/تحليل_تطوير " : "/تنفيذ_تطوير ";
      const proposalId = adminText.slice(prefix.length).trim();
      const endpoint = isAssess ? "/admin/assess-self-improvement" : "/admin/implement-self-improvement";
      // Same chat_id/background-delivery reasoning as /موافقة_تطوير above.
      const { ok, data } = await callNovaBackend(endpoint, { proposal_id: proposalId, chat_id: String(chatId) });
      const message = ok ? data?.message || "خطأ غير معروف" : data?.detail || "تعذر الاتصال بخادم Nova AI.";
      await bot.api.sendMessage(chatId, message, { reply_markup: novaAdminMenu() });
      return;
    }
    if (adminText === "📢 بث جماعي") {
      await bot.api.sendMessage(
        chatId,
        "اكتب الأمر متبوعاً بنص البث: /بث نص الرسالة\n\nاذكر فقط ما أضفناه أو حسّنّاه — دون تفاصيل داخلية أو حساسة عن سير العمل. سيبدأ الإعلان تلقائياً بـ #تحديث ما لم تبدأ رسالتك بوسم آخر بنفسك.",
        { reply_markup: novaAdminMenu() }
      );
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
      const messageText = formatBroadcastText(broadcastText);
      let sent = 0;
      for (const id of ids) {
        try {
          await bot.api.sendMessage(Number(id), messageText);
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
    // The user already picked an exact manual-library operation by
    // tapping its button (see MANUAL_PHOTO_OPS above) — this photo is
    // unambiguously that operation's input, checked before falling back
    // to the generic AI-vision path.
    const manualOp = msg.reply_to_message?.text ? parseManualPhotoPrompt(String(msg.reply_to_message.text)) : null;
    if (manualOp) {
      await handleManualPhotoOp(bot, chatId, largest.file_id, manualOp);
      return;
    }
    await handleImageMessage(bot, chatId, tgUserId, largest.file_id, msg.caption);
    return;
  }

  if (msg.document) {
    await handleDocumentMessage(bot, chatId, tgUserId, msg.document.file_id, msg.document.file_name, msg.caption);
    return;
  }

  if (!msg.text) return;
  const text = String(msg.text).trim();

  // Legitimate, deterministic reply-matching (see the comment above
  // parseStudioInputPrompt for why this is unlike the removed
  // image/video force_reply trick) — the user already picked an exact
  // tool+mode by tapping a button, so this text is unambiguously that
  // tool's input, checked before any other routing.
  const studioMatch = msg.reply_to_message?.text ? parseStudioInputPrompt(String(msg.reply_to_message.text)) : null;
  if (studioMatch) {
    const tool = STUDIO_TOOLS[studioMatch.toolKey];
    await bot.api.sendChatAction(chatId, "typing").catch(() => null);
    try {
      const res = await fetch(`${SITE_URL}${tool.endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: studioMatch.modeKey, input: text }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json().catch(() => ({}));
      await bot.api.sendMessage(chatId, res.ok && data.output ? data.output : data?.error || "تعذّر تنفيذ الأداة الآن، حاول لاحقاً.");
    } catch {
      await bot.api.sendMessage(chatId, "تعذّر الاتصال بالأداة — حاول لاحقاً.");
    }
    return;
  }

  const calcMatch = msg.reply_to_message?.text
    ? Object.values(STUDIO_CALC_TOOLS).find((t) => t.instructions === msg.reply_to_message.text)
    : undefined;
  if (calcMatch) {
    await bot.api.sendChatAction(chatId, "typing").catch(() => null);
    const result = await calcMatch.handle(text);
    await bot.api.sendMessage(chatId, "text" in result ? result.text : result.error);
    return;
  }

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
      "أنا نوفا NOVA مساعد ذكاء اصطناعي متعدد اللغات متعدد المصادر. ليس لدي مالك أو شركة لدي والد فقط هو من قام بابتكاري وتطويري والدي هو المطور السوري، وقد صممني لأحلّق في فضاء سوريا والعالم. أنا هنا لمساعدتك في الحصول على المعلومات التي تحتاجها بأدق وأوضح طريقة ممكنة.\n\nأهلاً بك مرة أخرى.....🤗\n\nاكتب أي سؤال مباشرة (أو أرسل رسالة صوتية، صورة، أو ملف PDF/Word) — بما في ذلك طلب توليد صورة أو فيديو، بلا حاجة لأي زر. استخدم \"🎬 الاستوديو\" أدناه لأدوات إضافية حقيقية (تعديل صورك، أدوات الموقع)، أو لعرض لوحتك، أو للترقية.",
      { reply_markup: novaMainMenu() }
    );
    return;
  }

  if (text === "🎬 الاستوديو") {
    await bot.api.sendMessage(chatId, "🎬 الاستوديو — اختر قسماً:", { reply_markup: studioRootMenu() });
    return;
  }

  if (text === "🔙 القائمة الرئيسية") {
    await bot.api.sendMessage(chatId, "القائمة الرئيسية:", { reply_markup: isAdmin ? novaAdminMenu() : novaMainMenu() });
    return;
  }

  if (text === "🔙 الاستوديو") {
    await bot.api.sendMessage(chatId, "🎬 الاستوديو — اختر قسماً:", { reply_markup: studioRootMenu() });
    return;
  }

  if (text === "🔙 أدوات وحاسبات") {
    await bot.api.sendMessage(chatId, "🧮 اختر أداة:", { reply_markup: studioCalcMenu() });
    return;
  }

  if (text === "✋ المكتبة اليدوية (على صورك)") {
    await bot.api.sendMessage(
      chatId,
      "✋ المكتبة اليدوية — أدوات حقيقية بالكود على صورتك أنت مباشرة، بلا أي ذكاء اصطناعي:\n\n" +
        "اختر عملية من الأزرار أدناه، ثم أرسل الصورة رداً على الرسالة التي سيرسلها البوت.",
      { reply_markup: manualLibraryMenu() }
    );
    return;
  }

  if (text in MANUAL_PHOTO_OPS) {
    await bot.api.sendMessage(chatId, manualPhotoPromptText(text), { reply_markup: manualLibraryMenu() });
    return;
  }

  if (text === "🧮 أدوات وحاسبات") {
    await bot.api.sendMessage(chatId, "🧮 اختر أداة:", { reply_markup: studioCalcMenu() });
    return;
  }

  {
    const toolKey = findStudioToolByLabel(text);
    if (toolKey) {
      await bot.api.sendMessage(chatId, `${STUDIO_TOOLS[toolKey].label} — اختر الوضع:`, { reply_markup: studioModesMenu(toolKey) });
      return;
    }
    const modeMatch = findStudioModeByLabel(text);
    if (modeMatch) {
      await bot.api.sendMessage(chatId, studioInputPromptText(modeMatch.toolKey, modeMatch.modeKey), { reply_markup: studioModesMenu(modeMatch.toolKey) });
      return;
    }
    const calcToolEntry = Object.values(STUDIO_CALC_TOOLS).find((t) => t.label === text);
    if (calcToolEntry) {
      await bot.api.sendMessage(chatId, calcToolEntry.instructions, { reply_markup: studioCalcMenu() });
      return;
    }
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

  if (text === "🔗 ربط حساباتي" || text === "/ربط") {
    // Owner spec, 2026-09-13 ("نظام الربط الحقيقي... يضيف نوفا لمواقعه
    // كما اضفتك انا لمواقعي"): the ONE place this stays a link rather
    // than answered directly in the bot (contrast the dashboard's own
    // "لاتهمنا لوحة الموقع... اجعلها كلها في البوت" precedent above) —
    // adding a real credential here has to happen on a dedicated page,
    // never in a chat message. Every ordinary message flows through
    // council.classify_intent (sent to Groq) and quota.log_usage
    // (stored durably into NovaUsageLog, which trains next week's
    // model) — pasting a token in this chat would leak it to a third
    // party AND bake it into training data. See src/app/nova/connections
    // and ai-system/app/connections.py for the rest of this feature.
    const { ok, data } = await callNovaBackend("/whoami", { channel: "TELEGRAM", telegram_id: tgUserId });
    if (!ok || !data.nova_user_id) {
      await bot.api.sendMessage(chatId, "تعذر فتح صفحة الربط — حاول مرة أخرى بعد قليل.");
      return;
    }
    const link = `${SITE_URL}/nova/connections?uid=${data.nova_user_id}`;
    await bot.api.sendMessage(
      chatId,
      `🔗 اربط نوفا بمستودعك الخاص من هنا:\n${link}\n\nبعد الربط، يمكنك أن تطلب من نوفا مباشرة هنا في المحادثة أن يعدّل أو يصلح ملفاً في مستودعك — لن يلمس أي شيء لم تربطه صراحة.`
    );
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

  // Explicit /صورة and /فيديو commands stay as direct fast-paths — a
  // literal typed command isn't "force" (nobody is required to use it,
  // and it saves one classification model call for whoever prefers
  // typing it) — but every other message, whatever its wording, falls
  // straight through to /chat below and lets OUR OWN model decide.
  const isExplicitImageCommand = text.startsWith("/صورة") || text.startsWith("/image");
  const isExplicitVideoCommand = text.startsWith("/فيديو") || text.startsWith("/video");

  if (isExplicitImageCommand) {
    // OUR OWN image-generation model (council.generate_image), self-
    // hosted on our own ModelScope Studio — not a third-party API call.
    //
    // Owner spec, 2026-09-09: async now, like /فيديو below — real
    // evidence (Render logs) that Hugging Face's free tier refuses to
    // serve our own image model moved this to our own CPU-only
    // ModelScope Studio, where inference is genuinely slow. The old
    // synchronous, wait-for-the-photo-inline design only worked while
    // this was calling a third party's own (fast) infrastructure.
    const prompt = text.replace(/^\/(صورة|image)\s*/, "").trim();
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

  if (isExplicitVideoCommand) {
    // OUR OWN video-generation model (council.generate_video /
    // HF_VIDEO_MODEL_ID — see ai-system/colab/generate_image_model.ipynb's
    // video-gen cells). Unlike /صورة above, this is async (like /image
    // and /chat) — real video-generation latency is unmeasured and
    // could easily exceed this route's own timeout, so the backend
    // pushes the finished video straight to Telegram once ready
    // instead of waiting for it inline here.
    const prompt = text.replace(/^\/(فيديو|video)\s*/, "").trim();
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
  //
  // Wording kept intent-neutral ("جارٍ المعالجة" rather than "جارٍ
  // التفكير في إجابتك") since this file no longer knows in advance
  // whether the backend will answer in text or turn out to be an
  // image/video request — council.classify_intent decides that itself
  // once the background task starts, and sends its own "🖼/🎬 جارٍ
  // التوليد" message at that point if so.
  await bot.api.sendMessage(chatId, "⏳ جارٍ المعالجة...").catch(() => null);
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

  // Owner spec, 2026-09-09: the old "اكتب قص/تصغير في الوصف" caption
  // trick is gone — replaced by MANUAL_PHOTO_OPS's menu-driven flow
  // above (handleManualPhotoOp), reached via "✋ المكتبة اليدوية" and
  // matched by reply_to_message like every other Studio input, not by
  // a caption the user had to remember and type exactly.

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
