import { Bot as TelegramBot, InlineKeyboard, InputFile, Keyboard } from "grammy";
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
// Owner spec, 2026-09-09: "توليد صورة"/"توليد فيديو" as dedicated
// buttons are gone — the free-text AI understanding built into /chat
// (council.classify_intent) already covers that without a button ("لا
// داعي للزرين الحاليين"). "🎬 الاستوديو" replaces them with real,
// non-AI tools instead: editing the user's OWN photos (crop/resize)
// and the site's already-working free tools, both wired below.
function novaMainMenu(): Keyboard {
  return new Keyboard()
    .text("🎬 الاستوديو").row()
    .text("🎛 لوحتي").text("📜 سجل المحادثات").row()
    .text("💎 ترقية")
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

// Owner spec, 2026-09-09 ("قسم في لوحة المستخدم... وظائف مجاني ومدفوع
// ونربطها بادوات حقيقية تعمل على موقعنا... حالياً كله مجاني حتى يكتمل
// البناء"): "🧰 أدوات الموقع" wires the bot to the SAME free-tools API
// routes the website already serves (src/app/api/free-tools/*) — real,
// already-working endpoints, not new AI logic. All free for now per
// that spec; gating a mode behind a paid plan later is a one-line
// change here (check the user's plan the same way _enforce_quota does
// on the Python side) once the owner decides which ones become paid.
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

function studioCalcMenu(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const [key, tool] of Object.entries(STUDIO_CALC_TOOLS)) {
    kb.text(tool.label, `studio|calc|${key}`).row();
  }
  return kb;
}

function studioRootMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✋ المكتبة اليدوية (على صورك)", "studio|manual").row()
    .text("🧰 أدوات الموقع", "studio|tools").row()
    .text("🧮 أدوات وحاسبات", "studio|calc");
}

function studioToolsMenu(): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const [key, tool] of Object.entries(STUDIO_TOOLS)) {
    kb.text(tool.label, `studio|tools|${key}`).row();
  }
  return kb;
}

function studioModesMenu(toolKey: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const [modeKey, label] of Object.entries(STUDIO_TOOLS[toolKey].modes)) {
    kb.text(label, `studio|tools|${toolKey}|${modeKey}`).row();
  }
  return kb;
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

async function handleStudioCallback(bot: TelegramBot, cq: any) {
  const chatId = cq.message?.chat?.id;
  await bot.api.answerCallbackQuery(cq.id).catch(() => null);
  if (!chatId) return;

  const parts = String(cq.data || "").split("|"); // ["studio", ...]

  if (parts[1] === "manual") {
    await bot.api.sendMessage(
      chatId,
      "✋ المكتبة اليدوية — أدوات حقيقية بالكود على صورتك أنت مباشرة، بلا أي ذكاء اصطناعي:\n\n" +
        "أرسل صورة، واكتب في خانة الوصف (caption) قبل الإرسال إحدى الكلمتين:\n" +
        "• قص — يقصّها إلى مربّع\n" +
        "• تصغير — يصغّر حجمها\n\n" +
        "مثال: أرفق الصورة واكتب \"قص\" في خانة الوصف."
    );
    return;
  }

  if (parts[1] === "tools" && parts.length === 2) {
    await bot.api.sendMessage(chatId, "🧰 اختر أداة:", { reply_markup: studioToolsMenu() });
    return;
  }

  if (parts[1] === "tools" && parts.length === 3 && STUDIO_TOOLS[parts[2]]) {
    await bot.api.sendMessage(chatId, `${STUDIO_TOOLS[parts[2]].label} — اختر الوضع:`, {
      reply_markup: studioModesMenu(parts[2]),
    });
    return;
  }

  if (parts[1] === "tools" && parts.length === 4 && STUDIO_TOOLS[parts[2]]?.modes[parts[3]]) {
    await bot.api.sendMessage(chatId, studioInputPromptText(parts[2], parts[3]));
    return;
  }

  if (parts[1] === "calc" && parts.length === 2) {
    await bot.api.sendMessage(chatId, "🧮 اختر أداة:", { reply_markup: studioCalcMenu() });
    return;
  }

  if (parts[1] === "calc" && parts.length === 3 && STUDIO_CALC_TOOLS[parts[2]]) {
    await bot.api.sendMessage(chatId, STUDIO_CALC_TOOLS[parts[2]].instructions);
    return;
  }
}

export async function handleNovaBotUpdate(bot: TelegramBot, _botRow: BotRow, update: any) {
  if (update.callback_query) {
    const cqData = String(update.callback_query.data || "");
    if (cqData.startsWith("nova_plan|")) {
      await handleNovaPlanCallback(bot, update.callback_query);
    } else if (cqData.startsWith("studio|")) {
      await handleStudioCallback(bot, update.callback_query);
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

  // Owner spec, 2026-09-09 ("المكتبة اليدوية"): a caption of "قص" or
  // "تصغير" routes to REAL, non-AI, code-only image editing
  // (src/app/api/nova/studio/image-edit — plain sharp crop/resize)
  // instead of the AI vision pipeline below. Fast enough (well under a
  // second) to answer inline, unlike vision's genuine multi-minute
  // CPU-only inference — a completely different, deterministic path,
  // not a shortcut through the AI.
  const studioOp = caption?.trim() === "قص" ? "crop-square" : caption?.trim() === "تصغير" ? "resize-small" : null;
  if (studioOp) {
    try {
      const res = await fetch(`${SITE_URL}/api/nova/studio/image-edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: studioOp, image_base64: imageBase64 }),
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.image_base64) {
        await bot.api.sendMessage(chatId, data?.error || "تعذّر تعديل الصورة — حاول مرة أخرى.");
        return;
      }
      await bot.api.sendPhoto(chatId, new InputFile(Buffer.from(data.image_base64, "base64"), "edited.jpg"));
    } catch {
      await bot.api.sendMessage(chatId, "تعذّر الاتصال بأداة تعديل الصور — حاول لاحقاً.");
    }
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
