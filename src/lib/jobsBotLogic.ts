import { Bot as TelegramBot, Keyboard, InlineKeyboard } from "grammy";
import { prisma } from "@/lib/prisma";
import type { Bot as BotRow, JobsProfile, JobsUser } from "@prisma/client";
import { getMasterHotWalletAddress, isNativeTonConfigured } from "@/services/ton-service";
import { getOrCreateJobsTonMemo } from "@/services/jobsTonService";
import { askNovaAssist, improveListingText, novaAssistConfigured } from "@/lib/novaAssist";
import { isAdVerifyPayload, consumeAdVerifyPayload } from "@/lib/adVerifyPayload";

/**
 * JOBS_BOT template (owner spec, 2026-09-05) — فرص عمل + متجر بيع وشراء.
 * A second owner-only private bot, same governance model as MARRIAGE_BOT
 * (see prisma/schema.prisma's JobsUser/JobsProfile/... block). Fully
 * independent from AD_BOT and MARRIAGE_BOT — no shared tables, no shared
 * logic files, no shared payment routes.
 *
 * Core structure:
 * - One profile per user with an EXCLUSIVE role chosen once: SEEKER,
 *   EMPLOYER, TRADER, or PROFESSIONAL. Never two roles at once.
 * - Two independent top-level sections, open to browse regardless of role:
 *   💼 العمل (نشر — role-gated to EMPLOYER/PROFESSIONAL; بحث — open to all)
 *   🛒 المتجر (بيع/شراء — role-gated to TRADER; بحث — open to all)
 * - Search results: a 5-item summary list + "عرض التفاصيل" per row opens
 *   a full detail card (Telegram has no native multi-card-with-buttons
 *   layout — sendMediaGroup can't carry inline keyboards).
 * - Store purchases can go through escrow: buyer's balance is charged and
 *   held on the StoreOrder row itself (never early-credited to the
 *   seller) until the buyer confirms receipt, a dispute is resolved, or
 *   7 days pass with no dispute (auto-release cron).
 */

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_TELEGRAM_ID || "";
const RESULTS_PAGE_SIZE = 5;
const ESCROW_AUTO_RELEASE_DAYS = 7;

const PROFESSIONAL_CATEGORIES = [
  "نجار", "حداد", "سباك", "كهربائي", "دهان", "ميكانيكي سيارات",
  "فني تكييف وتبريد", "بنّاء", "مبلّط", "فني جبس وديكور", "حداد ألمنيوم",
  "فني زجاج", "سائق", "بستاني", "عامل نظافة", "خياط",
  "حلاق ومصفف شعر", "فني كمبيوتر وموبايل", "مصوّر", "طباخ وشيف",
  "عامل مطعم", "حارس أمن", "عامل مستودع وتحميل",
];
const OTHER_CATEGORY_LABEL = "✏️ مهنة أخرى (اكتبها)";

function shortId(id: string): string {
  return id.slice(-6);
}
function relativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "قبل لحظات";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `قبل ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `قبل ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  return `قبل ${days} يوم`;
}
function roleLabel(role: string): string {
  if (role === "SEEKER") return "👷 باحث عن عمل";
  if (role === "EMPLOYER") return "🏢 معلن وظيفة";
  if (role === "PROFESSIONAL") return "🔨 مهني مقدّم خدمة";
  return "🛒 تاجر";
}

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
type RoleType = "SEEKER" | "EMPLOYER" | "TRADER" | "PROFESSIONAL";
type ProfileStep =
  | "name" | "age" | "country" | "governorate" | "city" | "contactMethod" | "contactValue"
  | "role" | "seekerProfession" | "employerBusinessName"
  | "professionalCategory" | "professionalCategoryOther" | "professionalDescription";

type ProfileDraft = {
  name?: string;
  age?: number;
  country?: string;
  governorate?: string;
  city?: string;
  contactMethod?: "TELEGRAM" | "WHATSAPP";
  contactValue?: string;
  roleType?: RoleType;
  seekerProfession?: string;
  employerBusinessName?: string;
  professionalCategory?: string;
  professionalDescription?: string;
};

type JobPostingStep = "title" | "keywords" | "workersCount" | "governorate" | "city" | "description" | "contactMethod" | "contactValue";
type JobPostingDraft = {
  title?: string;
  keywords?: string;
  workersCount?: number;
  governorate?: string;
  city?: string;
  description?: string;
  contactMethod?: "TELEGRAM" | "WHATSAPP";
  contactValue?: string;
};

type StoreListingStep = "title" | "description" | "price" | "photos" | "deliveryMethod" | "paymentMethod";
type StoreListingDraft = {
  title?: string;
  description?: string;
  price?: number;
  photoFileIds: string[];
  deliveryMethod?: "PICKUP_MANUAL" | "SHIPPING";
  paymentMethod?: "MANUAL" | "ESCROW";
};

type StoreWantedStep = "title" | "description" | "budget";
type StoreWantedDraft = { title?: string; description?: string; budget?: number | null };

type PendingAction =
  | { mode: "profile_wizard"; step: ProfileStep; data: ProfileDraft }
  | { mode: "job_posting_wizard"; step: JobPostingStep; data: JobPostingDraft }
  | { mode: "job_posting_description_review"; data: JobPostingDraft; suggested: string }
  | { mode: "ask_nova" }
  | { mode: "job_search_keyword"; fallbackKeyword?: string }
  | { mode: "store_search_keyword" }
  | { mode: "wanted_search_keyword" }
  | { mode: "offer_price"; kind: "LISTING" | "WANTED"; targetId: string }
  | { mode: "offer_counter"; offerId: string }
  | { mode: "professional_search_category" }
  | { mode: "professional_search_category_custom" }
  | { mode: "professional_search_region"; category: string }
  | { mode: "store_listing_wizard"; step: StoreListingStep; data: StoreListingDraft; editingId?: string }
  | { mode: "store_wanted_wizard"; step: StoreWantedStep; data: StoreWantedDraft; editingId?: string }
  | { mode: "report_reason"; targetId: string; targetKind: "profile" | "posting" | "listing" | "wanted" }
  | { mode: "report_evidence"; targetId: string; targetKind: "profile" | "posting" | "listing" | "wanted"; reason: string }
  | { mode: "dispute_statement"; orderId: string; side: "buyer" | "seller" }
  | { mode: "dispute_evidence"; orderId: string; side: "buyer" | "seller"; statement: string }
  | { mode: "contact_admin_compose" }
  | { mode: "suggestion_compose" }
  | { mode: "suggestion_confirm"; text: string }
  | { mode: "admin_broadcast" }
  | { mode: "admin_lookup" }
  | { mode: "admin_unban" }
  | { mode: "admin_channel" }
  | { mode: "admin_reply"; targetUserId: string; messageId: string };

// ---------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------
function backLabel(): string {
  return "◀️ رجوع";
}
function isBack(text: string): boolean {
  return text === backLabel();
}
const SKIP_LABEL = "⏭ تخطّي";
function isSkip(text: string): boolean {
  return text === SKIP_LABEL;
}
function skipMenu(): Keyboard {
  return new Keyboard().text(SKIP_LABEL).row().text(backLabel()).resized();
}
function infoMenu(): Keyboard {
  const kb = new Keyboard().text("💡 اقتراح").text("📩 مراسلة الأدمن").row();
  if (novaAssistConfigured()) kb.text("✨ اسأل نوفا (ذكاء اصطناعي)").row();
  return kb.text("🔗 مشاركة الرابط").row().text(backLabel()).resized();
}
function plainBackMenu(): Keyboard {
  return new Keyboard().text(backLabel()).resized();
}
function contactMethodMenu(): Keyboard {
  return new Keyboard().text("✈️ تلجرام").text("💬 واتساب").row().text(backLabel()).resized();
}

function mainMenu(): Keyboard {
  const kb = new Keyboard()
    .text("💼 قسم العمل").text("🛒 قسم المتجر").row()
    .text("👤 ملفي الشخصي").text("💰 رصيدي وإيداع").row();
  if (isNativeTonConfigured()) kb.text("🔷 إيداع TON / USDT مباشر").row();
  return kb.text("ℹ️ معلومات").resized();
}
function workMenu(): Keyboard {
  return new Keyboard().text("📢 نشر").text("🔍 بحث").row().text(backLabel()).resized();
}
function storeMenu(): Keyboard {
  return new Keyboard()
    .text("💰 أمر بيع").text("🛍 أمر شراء").row()
    .text("🔍 بحث عن منتج").text("🔍 تصفح المنتجات").row()
    .text("📂 طلباتي").row()
    .text(backLabel())
    .resized();
}
function storeBrowseMenu(): Keyboard {
  return new Keyboard().text("🛒 تصفح للبيع").text("🛍 تصفح للشراء").row().text(backLabel()).resized();
}
function storeSearchMenu(): Keyboard {
  return new Keyboard().text("🛍 لتشتري").text("💰 لتبيع").row().text(backLabel()).resized();
}
function myOrdersMenu(): Keyboard {
  return new Keyboard().text("🛍 طلباتي (شراء)").text("💰 طلباتي (بيع)").row().text(backLabel()).resized();
}
function workSearchMenu(): Keyboard {
  return new Keyboard().text("🔍 عن مهني").text("🔍 عن وظيفة شاغرة").row().text(backLabel()).resized();
}
function roleMenu(): Keyboard {
  return new Keyboard()
    .text("👷 باحث عن عمل").text("🏢 معلن وظيفة").row()
    .text("🔨 مهني مقدّم خدمة").text("🛒 تاجر").row()
    .text(backLabel())
    .resized();
}
function professionalCategoryMenu(): Keyboard {
  const kb = new Keyboard();
  for (let i = 0; i < PROFESSIONAL_CATEGORIES.length; i += 2) {
    kb.text(PROFESSIONAL_CATEGORIES[i]);
    if (PROFESSIONAL_CATEGORIES[i + 1]) kb.text(PROFESSIONAL_CATEGORIES[i + 1]);
    kb.row();
  }
  kb.text(OTHER_CATEGORY_LABEL).row().text(backLabel());
  return kb.resized();
}
function adminMenu(): Keyboard {
  return new Keyboard()
    .text("📊 الإحصائيات").text("📥 رسائل واردة").row()
    .text("💰 المحفظة").text("🔎 بحث عن مستخدم").row()
    .text("📡 قناة الاشتراك الإجباري").text("🔓 رفع حظر/كتم").row()
    .text("📢 بث جماعي")
    .resized();
}

// ---------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------
// upsert, not findUnique-then-create — see adBotLogic.ts's ensureUser for
// why the check-then-act version is a real race (two near-simultaneous
// updates from the same brand-new user can both pass the existence check
// and the second create() throws, crashing the webhook silently).
async function ensureJobsUser(botId: string, tgUserId: string) {
  return prisma.jobsUser.upsert({ where: { id: tgUserId }, update: {}, create: { id: tgUserId, botId } });
}
async function setPending(userId: string, action: PendingAction | null) {
  await prisma.jobsUser.update({ where: { id: userId }, data: { pendingAction: action as any } });
}
async function isBlocked(aId: string, bId: string): Promise<boolean> {
  const b = await prisma.jobsBlock.findFirst({ where: { OR: [{ blockerId: aId, blockedId: bId }, { blockerId: bId, blockedId: aId }] } });
  return !!b;
}
// Ids on either side of a block involving userId — either direction, since
// a block is meant to sever contact/visibility mutually, not just one-way.
async function blockedPeerIds(userId: string): Promise<string[]> {
  const rows = await prisma.jobsBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
  });
  const ids = new Set<string>();
  for (const r of rows) ids.add(r.blockerId === userId ? r.blockedId : r.blockerId);
  return Array.from(ids);
}
function depositLink(userId: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
  return `${base}/pay/jobs?uid=${userId}`;
}
async function chargeJobsUser(userId: string, amount: number, type: string): Promise<{ ok: boolean; balance: number }> {
  // Atomic check-and-decrement inside one DB transaction: updateMany's
  // WHERE clause balance check is evaluated by Postgres as part of the
  // UPDATE itself (row-locked), so two concurrent charges against the
  // same user (e.g. two sellers accepting separate offers from the same
  // buyer at nearly the same moment) can no longer both pass a stale
  // in-JS balance check and drive the balance negative — the previous
  // version read the balance, checked it in JS, then decremented in a
  // separate step, which was a real TOCTOU race.
  return prisma.$transaction(async (tx) => {
    const result = await tx.jobsUser.updateMany({
      where: { id: userId, balance: { gte: amount } },
      data: { balance: { decrement: amount } },
    });
    const current = await tx.jobsUser.findUnique({ where: { id: userId } });
    const balance = Number(current?.balance || 0);
    if (result.count === 0) return { ok: false, balance };
    await tx.jobsTransaction.create({ data: { userId, amount, currency: "internal", type, status: "COMPLETED" } });
    return { ok: true, balance };
  });
}
async function creditJobsUser(userId: string, amount: number, type: string) {
  await prisma.$transaction([
    prisma.jobsUser.update({ where: { id: userId }, data: { balance: { increment: amount } } }),
    prisma.jobsTransaction.create({ data: { userId, amount, currency: "internal", type, status: "COMPLETED" } }),
  ]);
}

// ---------------------------------------------------------------------
// Profile wizard (base fields + exclusive role branch)
// ---------------------------------------------------------------------
const BASE_STEP_ORDER: ProfileStep[] = ["name", "age", "country", "governorate", "city", "contactMethod", "contactValue", "role"];

function nextProfileStep(step: ProfileStep, data: ProfileDraft): ProfileStep | null {
  const baseIdx = BASE_STEP_ORDER.indexOf(step);
  if (baseIdx >= 0 && baseIdx + 1 < BASE_STEP_ORDER.length) return BASE_STEP_ORDER[baseIdx + 1];
  if (step === "role") {
    if (data.roleType === "SEEKER") return "seekerProfession";
    if (data.roleType === "EMPLOYER") return "employerBusinessName";
    if (data.roleType === "PROFESSIONAL") return "professionalCategory";
    return null; // TRADER — no extra fields
  }
  if (step === "seekerProfession") return null;
  if (step === "employerBusinessName") return null;
  if (step === "professionalCategory") return null; // handled specially — see consumeProfileStep
  if (step === "professionalCategoryOther") return "professionalDescription";
  if (step === "professionalDescription") return null;
  return null;
}

async function askProfileStep(bot: TelegramBot, chatId: number, step: ProfileStep) {
  switch (step) {
    case "name":
      await bot.api.sendMessage(chatId, "👋 لنبدأ بإنشاء ملفك الشخصي.\n\nما اسمك؟", { reply_markup: plainBackMenu() });
      break;
    case "age":
      await bot.api.sendMessage(chatId, "كم عمرك؟", { reply_markup: plainBackMenu() });
      break;
    case "country":
      await bot.api.sendMessage(chatId, "ما هي دولتك؟", { reply_markup: plainBackMenu() });
      break;
    case "governorate":
      await bot.api.sendMessage(chatId, "ما هي محافظتك؟", { reply_markup: plainBackMenu() });
      break;
    case "city":
      await bot.api.sendMessage(chatId, "ما هي مدينتك؟", { reply_markup: plainBackMenu() });
      break;
    case "contactMethod":
      await bot.api.sendMessage(chatId, "ما وسيلة التواصل التي تفضلها؟", { reply_markup: contactMethodMenu() });
      break;
    case "contactValue":
      await bot.api.sendMessage(chatId, "أرسل معرّفك في تلجرام (@username) أو رقم هاتفك على واتساب:", { reply_markup: plainBackMenu() });
      break;
    case "role":
      await bot.api.sendMessage(
        chatId,
        "اختر نوع ملفك الشخصي — هذا الاختيار حصري ولا يمكن الجمع بين أكثر من نوع:\n\n" +
          "👷 باحث عن عمل — تبحث عن وظيفة\n🏢 معلن وظيفة — تحتاج عمالاً\n🔨 مهني مقدّم خدمة — تعرض حرفتك\n🛒 تاجر — تريد بيع/شراء في المتجر",
        { reply_markup: roleMenu() }
      );
      break;
    case "seekerProfession":
      await bot.api.sendMessage(chatId, "ما المهنة التي تتقنها أو تبحث عنها؟ (تُستخدم للمطابقة مع الوظائف الشاغرة)", { reply_markup: plainBackMenu() });
      break;
    case "employerBusinessName":
      await bot.api.sendMessage(chatId, "ما اسم عملك/شركتك/متجرك؟", { reply_markup: plainBackMenu() });
      break;
    case "professionalCategory":
      await bot.api.sendMessage(chatId, "اختر الحرفة/الخدمة التي تقدّمها:", { reply_markup: professionalCategoryMenu() });
      break;
    case "professionalCategoryOther":
      await bot.api.sendMessage(chatId, "اكتب اسم مهنتك:", { reply_markup: plainBackMenu() });
      break;
    case "professionalDescription":
      await bot.api.sendMessage(chatId, "اكتب وصفاً موجزاً لأعمالك وخبرتك (يظهر لمن يبحث عنك):", { reply_markup: plainBackMenu() });
      break;
  }
}

async function startProfileWizard(bot: TelegramBot, chatId: number, userId: string) {
  await setPending(userId, { mode: "profile_wizard", step: "name", data: {} });
  await askProfileStep(bot, chatId, "name");
}

async function saveProfile(bot: TelegramBot, chatId: number, userId: string, data: ProfileDraft) {
  await prisma.jobsProfile.upsert({
    where: { userId },
    update: {
      name: data.name!, age: data.age!, country: data.country!, governorate: data.governorate!, city: data.city!,
      contactMethod: data.contactMethod!, contactValue: data.contactValue!, roleType: data.roleType!,
      seekerProfession: data.seekerProfession ?? null,
      employerBusinessName: data.employerBusinessName ?? null,
      professionalCategory: data.professionalCategory ?? null,
      professionalDescription: data.professionalDescription ?? null,
    },
    create: {
      userId, name: data.name!, age: data.age!, country: data.country!, governorate: data.governorate!, city: data.city!,
      contactMethod: data.contactMethod!, contactValue: data.contactValue!, roleType: data.roleType!,
      seekerProfession: data.seekerProfession ?? null,
      employerBusinessName: data.employerBusinessName ?? null,
      professionalCategory: data.professionalCategory ?? null,
      professionalDescription: data.professionalDescription ?? null,
    },
  });
  await setPending(userId, null);
  await bot.api.sendMessage(chatId, "✅ تم حفظ ملفك الشخصي. اختر من القائمة:", { reply_markup: mainMenu() });
}

async function consumeProfileStep(bot: TelegramBot, chatId: number, userId: string, pending: Extract<PendingAction, { mode: "profile_wizard" }>, text: string) {
  const { step, data } = pending;
  if (step === "name") {
    if (!text) return;
    data.name = text;
  } else if (step === "age") {
    const age = Number(text.replace(/[^0-9]/g, ""));
    if (!Number.isFinite(age) || age < 16 || age > 90) {
      await bot.api.sendMessage(chatId, "أرسل عمراً صحيحاً (16 فأكثر).");
      return;
    }
    data.age = age;
  } else if (step === "country") {
    if (!text) return;
    data.country = text;
  } else if (step === "governorate") {
    if (!text) return;
    data.governorate = text;
  } else if (step === "city") {
    if (!text) return;
    data.city = text;
  } else if (step === "contactMethod") {
    if (text !== "✈️ تلجرام" && text !== "💬 واتساب") {
      await bot.api.sendMessage(chatId, "اختر من القائمة.", { reply_markup: contactMethodMenu() });
      return;
    }
    data.contactMethod = text === "✈️ تلجرام" ? "TELEGRAM" : "WHATSAPP";
  } else if (step === "contactValue") {
    if (!text) return;
    data.contactValue = data.contactMethod === "WHATSAPP" ? text.replace(/[^0-9+]/g, "") : text.replace(/^@/, "");
  } else if (step === "role") {
    const map: Record<string, RoleType> = {
      "👷 باحث عن عمل": "SEEKER",
      "🏢 معلن وظيفة": "EMPLOYER",
      "🔨 مهني مقدّم خدمة": "PROFESSIONAL",
      "🛒 تاجر": "TRADER",
    };
    if (!map[text]) {
      await bot.api.sendMessage(chatId, "اختر من القائمة.", { reply_markup: roleMenu() });
      return;
    }
    data.roleType = map[text];
  } else if (step === "seekerProfession") {
    if (!text) return;
    data.seekerProfession = text;
  } else if (step === "employerBusinessName") {
    if (!text) return;
    data.employerBusinessName = text;
  } else if (step === "professionalCategory") {
    if (text === OTHER_CATEGORY_LABEL) {
      await setPending(userId, { mode: "profile_wizard", step: "professionalCategoryOther", data });
      await askProfileStep(bot, chatId, "professionalCategoryOther");
      return;
    }
    if (!PROFESSIONAL_CATEGORIES.includes(text)) {
      await bot.api.sendMessage(chatId, "اختر من القائمة.", { reply_markup: professionalCategoryMenu() });
      return;
    }
    data.professionalCategory = text;
    await setPending(userId, { mode: "profile_wizard", step: "professionalDescription", data });
    await askProfileStep(bot, chatId, "professionalDescription");
    return;
  } else if (step === "professionalCategoryOther") {
    if (!text) return;
    data.professionalCategory = text;
  } else if (step === "professionalDescription") {
    data.professionalDescription = text;
  }

  const next = nextProfileStep(step, data);
  if (!next) {
    await saveProfile(bot, chatId, userId, data);
    return;
  }
  await setPending(userId, { mode: "profile_wizard", step: next, data });
  await askProfileStep(bot, chatId, next);
}

// ---------------------------------------------------------------------
// Work section — نشر (post)
// ---------------------------------------------------------------------
const JOB_POSTING_STEP_ORDER: JobPostingStep[] = ["title", "keywords", "workersCount", "governorate", "city", "description", "contactMethod", "contactValue"];
function nextJobPostingStep(step: JobPostingStep): JobPostingStep | null {
  const i = JOB_POSTING_STEP_ORDER.indexOf(step);
  return i >= 0 && i + 1 < JOB_POSTING_STEP_ORDER.length ? JOB_POSTING_STEP_ORDER[i + 1] : null;
}
async function askJobPostingStep(bot: TelegramBot, chatId: number, step: JobPostingStep) {
  switch (step) {
    case "title":
      await bot.api.sendMessage(chatId, "📢 نشر وظيفة شاغرة\n\nما مسمى الوظيفة؟", { reply_markup: plainBackMenu() });
      break;
    case "keywords":
      await bot.api.sendMessage(chatId, "أضف كلمات مفتاحية تصف الوظيفة (مفصولة بفواصل) — تُستخدم في مطابقة بحث الباحثين عن عمل:", { reply_markup: plainBackMenu() });
      break;
    case "workersCount":
      await bot.api.sendMessage(chatId, "كم عدد العمال المطلوبين؟", { reply_markup: skipMenu() });
      break;
    case "governorate":
      await bot.api.sendMessage(chatId, "في أي محافظة؟", { reply_markup: plainBackMenu() });
      break;
    case "city":
      await bot.api.sendMessage(chatId, "في أي مدينة؟", { reply_markup: plainBackMenu() });
      break;
    case "description":
      await bot.api.sendMessage(chatId, "وصف إضافي للوظيفة (اختياري):", { reply_markup: skipMenu() });
      break;
    case "contactMethod":
      await bot.api.sendMessage(chatId, "وسيلة التواصل لهذه الوظيفة:", { reply_markup: contactMethodMenu() });
      break;
    case "contactValue":
      await bot.api.sendMessage(chatId, "أرسل معرّف تلجرام أو رقم واتساب للتواصل بخصوص هذه الوظيفة:", { reply_markup: plainBackMenu() });
      break;
  }
}
async function startJobPostingWizard(bot: TelegramBot, chatId: number, userId: string) {
  await setPending(userId, { mode: "job_posting_wizard", step: "title", data: {} });
  await askJobPostingStep(bot, chatId, "title");
}
async function consumeJobPostingStep(bot: TelegramBot, chatId: number, userId: string, pending: Extract<PendingAction, { mode: "job_posting_wizard" }>, text: string) {
  const { step, data } = pending;
  if (step === "title") {
    if (!text) return;
    data.title = text;
  } else if (step === "keywords") {
    if (!text) return;
    data.keywords = text;
  } else if (step === "workersCount") {
    data.workersCount = isSkip(text) ? 1 : Math.max(1, Number(text.replace(/[^0-9]/g, "")) || 1);
  } else if (step === "governorate") {
    if (!text) return;
    data.governorate = text;
  } else if (step === "city") {
    if (!text) return;
    data.city = text;
  } else if (step === "description") {
    data.description = isSkip(text) ? undefined : text;
    if (data.description && novaAssistConfigured()) {
      await bot.api.sendChatAction(chatId, "typing").catch(() => null);
      const suggestion = await improveListingText(userId, "إعلان وظيفة", data.description);
      if (suggestion.ok && suggestion.text && suggestion.text !== data.description) {
        await setPending(userId, { mode: "job_posting_description_review", data, suggested: suggestion.text });
        await bot.api.sendMessage(
          chatId,
          `📝 وصفك:\n${data.description}\n\n✨ اقتراح نوفا (ذكاء اصطناعي) لتحسينه:\n${suggestion.text}\n\nأي نسخة تريد نشرها؟`,
          { reply_markup: new InlineKeyboard().text("📝 وصفي الأصلي", "jai_use|orig").row().text("✨ نسخة نوفا المحسّنة", "jai_use|ai") }
        );
        return;
      }
    }
  } else if (step === "contactMethod") {
    if (text !== "✈️ تلجرام" && text !== "💬 واتساب") {
      await bot.api.sendMessage(chatId, "اختر من القائمة.", { reply_markup: contactMethodMenu() });
      return;
    }
    data.contactMethod = text === "✈️ تلجرام" ? "TELEGRAM" : "WHATSAPP";
  } else if (step === "contactValue") {
    if (!text) return;
    data.contactValue = data.contactMethod === "WHATSAPP" ? text.replace(/[^0-9+]/g, "") : text.replace(/^@/, "");
  }

  await advanceJobPostingStep(bot, chatId, userId, step, data);
}

async function advanceJobPostingStep(bot: TelegramBot, chatId: number, userId: string, step: JobPostingStep, data: JobPostingDraft) {
  const next = nextJobPostingStep(step);
  if (!next) {
    await prisma.jobPosting.create({
      data: {
        posterId: userId, title: data.title!, keywords: data.keywords!, workersCount: data.workersCount ?? 1,
        governorate: data.governorate!, city: data.city!, description: data.description ?? null,
        contactMethod: data.contactMethod!, contactValue: data.contactValue!,
      },
    });
    await setPending(userId, null);
    await bot.api.sendMessage(chatId, "✅ تم نشر الوظيفة الشاغرة.", { reply_markup: mainMenu() });
    return;
  }
  await setPending(userId, { mode: "job_posting_wizard", step: next, data });
  await askJobPostingStep(bot, chatId, next);
}

// ---------------------------------------------------------------------
// Search results — shared list+detail pattern
// ---------------------------------------------------------------------
async function sendJobPostingResults(bot: TelegramBot, chatId: number, keyword: string, offset: number, viewerId: string) {
  const blocked = await blockedPeerIds(viewerId);
  const postings = await prisma.jobPosting.findMany({
    where: {
      status: "OPEN",
      posterId: { notIn: blocked },
      OR: [{ title: { contains: keyword, mode: "insensitive" } }, { keywords: { contains: keyword, mode: "insensitive" } }],
    },
    orderBy: { created_at: "desc" },
    skip: offset,
    take: RESULTS_PAGE_SIZE,
  });
  if (postings.length === 0) {
    await bot.api.sendMessage(chatId, offset === 0 ? "😔 لا توجد وظائف مطابقة حالياً." : "🔚 لا يوجد المزيد من النتائج.", { reply_markup: mainMenu() });
    return;
  }
  const kb = new InlineKeyboard();
  const lines = postings.map((p, i) => {
    kb.text(`👁 عرض ${i + 1}`, `jview|posting|${p.id}`).row();
    return `${i + 1}. 🏢 ${p.title} — ${p.city} — عدد المطلوب: ${p.workersCount}`;
  });
  if (postings.length === RESULTS_PAGE_SIZE) kb.text("➡️ 5 نتائج أخرى", `jmore|posting|${encodeURIComponent(keyword)}|${offset + RESULTS_PAGE_SIZE}`);
  await bot.api.sendMessage(chatId, `🔍 نتائج البحث عن "${keyword}":\n\n${lines.join("\n")}`, { reply_markup: kb });
}

async function sendProfessionalResults(bot: TelegramBot, chatId: number, category: string, region: string, offset: number, viewerId: string) {
  const blocked = await blockedPeerIds(viewerId);
  const pros = await prisma.jobsProfile.findMany({
    where: {
      roleType: "PROFESSIONAL", isPaused: false,
      userId: { notIn: blocked },
      professionalCategory: { contains: category, mode: "insensitive" },
      OR: region ? [{ city: { contains: region, mode: "insensitive" } }, { governorate: { contains: region, mode: "insensitive" } }] : undefined,
    },
    orderBy: { created_at: "desc" },
    skip: offset,
    take: RESULTS_PAGE_SIZE,
  });
  if (pros.length === 0) {
    await bot.api.sendMessage(chatId, offset === 0 ? "😔 لا يوجد مهنيون مطابقون حالياً." : "🔚 لا يوجد المزيد من النتائج.", { reply_markup: mainMenu() });
    return;
  }
  const kb = new InlineKeyboard();
  const lines = pros.map((p, i) => {
    kb.text(`👁 عرض ${i + 1}`, `jview|profile|${p.userId}`).row();
    return `${i + 1}. 🔨 ${p.professionalCategory} — ${p.city}`;
  });
  if (pros.length === RESULTS_PAGE_SIZE) kb.text("➡️ 5 نتائج أخرى", `jmore|professional|${encodeURIComponent(category)}|${encodeURIComponent(region)}|${offset + RESULTS_PAGE_SIZE}`);
  await bot.api.sendMessage(chatId, `🔍 نتائج البحث عن مهني "${category}":\n\n${lines.join("\n")}`, { reply_markup: kb });
}

async function sendStoreResults(bot: TelegramBot, chatId: number, keyword: string, offset: number, viewerId: string) {
  const blocked = await blockedPeerIds(viewerId);
  const listings = await prisma.storeListing.findMany({
    where: {
      status: "ACTIVE",
      sellerId: { notIn: [...blocked, viewerId] }, // never show a viewer their own listing here — that lives in "📂 طلباتي"
      ...(keyword ? { OR: [{ title: { contains: keyword, mode: "insensitive" } }, { description: { contains: keyword, mode: "insensitive" } }] } : {}),
    },
    orderBy: { created_at: "desc" },
    skip: offset,
    take: RESULTS_PAGE_SIZE,
  });
  if (listings.length === 0) {
    await bot.api.sendMessage(chatId, offset === 0 ? "😔 لا توجد منتجات مطابقة حالياً." : "🔚 لا يوجد المزيد من النتائج.", { reply_markup: mainMenu() });
    return;
  }
  const kb = new InlineKeyboard();
  const lines = listings.map((l, i) => {
    kb.text(`👁 عرض ${i + 1}`, `jview|listing|${l.id}`).row();
    return `${i + 1}. 🛒 ${l.title} — $${l.price.toFixed(2)}`;
  });
  if (listings.length === RESULTS_PAGE_SIZE) kb.text("➡️ 5 نتائج أخرى", `jmore|listing|${encodeURIComponent(keyword)}|${offset + RESULTS_PAGE_SIZE}`);
  const title = keyword ? `🔍 نتائج البحث عن "${keyword}":` : "🛒 منتجات معروضة:";
  await bot.api.sendMessage(chatId, `${title}\n\n${lines.join("\n")}`, { reply_markup: kb });
}

function orderStatusLabel(status: string): string {
  if (status === "ACTIVE") return "🟢 نشط";
  if (status === "PAUSED") return "⏸ متوقف مؤقتاً";
  if (status === "SOLD") return "✅ مباع";
  if (status === "FULFILLED") return "✅ تم تلبيته";
  if (status === "REMOVED") return "🗑 محذوف";
  return `⚪️ ${status}`;
}

// Owner-only management actions on a StoreListing/StoreWantedListing —
// only reachable via "📂 طلباتي" (owner spec, 2026-09-06): a seller/buyer
// had no way to edit, pause, or remove what they already posted.
async function toggleListingStatus(bot: TelegramBot, chatId: number, userId: string, listingId: string) {
  const l = await prisma.storeListing.findUnique({ where: { id: listingId } });
  if (!l || l.sellerId !== userId) {
    await bot.api.sendMessage(chatId, "غير مسموح.");
    return;
  }
  if (l.status !== "ACTIVE" && l.status !== "PAUSED") {
    await bot.api.sendMessage(chatId, "لا يمكن تغيير حالة هذا المنتج.");
    return;
  }
  const newStatus = l.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
  await prisma.storeListing.update({ where: { id: listingId }, data: { status: newStatus } });
  await bot.api.sendMessage(chatId, newStatus === "ACTIVE" ? "▶️ تم تفعيل المنتج، وهو الآن ظاهر في التصفح." : "⏸ تم إيقاف المنتج مؤقتاً، لن يظهر في التصفح حتى تُعيد تفعيله.");
}
async function deleteListing(bot: TelegramBot, chatId: number, userId: string, listingId: string) {
  const l = await prisma.storeListing.findUnique({ where: { id: listingId } });
  if (!l || l.sellerId !== userId) {
    await bot.api.sendMessage(chatId, "غير مسموح.");
    return;
  }
  if (l.status !== "ACTIVE" && l.status !== "PAUSED") {
    await bot.api.sendMessage(chatId, "لا يمكن حذف هذا المنتج.");
    return;
  }
  await prisma.storeListing.update({ where: { id: listingId }, data: { status: "REMOVED" } });
  await bot.api.sendMessage(chatId, "🗑 تم حذف المنتج.");
}
async function toggleWantedStatus(bot: TelegramBot, chatId: number, userId: string, wantedId: string) {
  const w = await prisma.storeWantedListing.findUnique({ where: { id: wantedId } });
  if (!w || w.buyerId !== userId) {
    await bot.api.sendMessage(chatId, "غير مسموح.");
    return;
  }
  if (w.status !== "ACTIVE" && w.status !== "PAUSED") {
    await bot.api.sendMessage(chatId, "لا يمكن تغيير حالة هذا الطلب.");
    return;
  }
  const newStatus = w.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
  await prisma.storeWantedListing.update({ where: { id: wantedId }, data: { status: newStatus } });
  await bot.api.sendMessage(chatId, newStatus === "ACTIVE" ? "▶️ تم تفعيل طلبك، وهو الآن ظاهر في التصفح." : "⏸ تم إيقاف طلبك مؤقتاً، لن يظهر في التصفح حتى تُعيد تفعيله.");
}
async function deleteWanted(bot: TelegramBot, chatId: number, userId: string, wantedId: string) {
  const w = await prisma.storeWantedListing.findUnique({ where: { id: wantedId } });
  if (!w || w.buyerId !== userId) {
    await bot.api.sendMessage(chatId, "غير مسموح.");
    return;
  }
  if (w.status !== "ACTIVE" && w.status !== "PAUSED") {
    await bot.api.sendMessage(chatId, "لا يمكن حذف هذا الطلب.");
    return;
  }
  await prisma.storeWantedListing.update({ where: { id: wantedId }, data: { status: "REMOVED" } });
  await bot.api.sendMessage(chatId, "🗑 تم حذف طلبك.");
}

// Public browse/search of everyone's buy requests — the "🛍 تصفح للشراء" /
// "🔍 بحث عن طلب شراء" side of the store, mirroring sendStoreResults for
// sell listings (owner spec, 2026-09-06: browsing "تصفح المنتجات" and
// searching only ever surfaced sell listings, never buy requests).
async function sendWantedResults(bot: TelegramBot, chatId: number, keyword: string, offset: number, viewerId: string) {
  const blocked = await blockedPeerIds(viewerId);
  const wanted = await prisma.storeWantedListing.findMany({
    where: {
      status: "ACTIVE",
      buyerId: { notIn: [...blocked, viewerId] }, // never show a viewer their own request here — that lives in "📂 طلباتي"
      ...(keyword ? { OR: [{ title: { contains: keyword, mode: "insensitive" } }, { description: { contains: keyword, mode: "insensitive" } }] } : {}),
    },
    orderBy: { created_at: "desc" },
    skip: offset,
    take: RESULTS_PAGE_SIZE,
  });
  if (wanted.length === 0) {
    await bot.api.sendMessage(chatId, offset === 0 ? "😔 لا توجد طلبات شراء مطابقة حالياً." : "🔚 لا يوجد المزيد من النتائج.", { reply_markup: mainMenu() });
    return;
  }
  const kb = new InlineKeyboard();
  const lines = wanted.map((w, i) => {
    kb.text(`👁 عرض ${i + 1}`, `jview|wanted|${w.id}`).row();
    return `${i + 1}. 🛍 ${w.title}${w.budget ? ` — ميزانية تقريبية: $${w.budget.toFixed(2)}` : ""}`;
  });
  if (wanted.length === RESULTS_PAGE_SIZE) kb.text("➡️ 5 نتائج أخرى", `jmore|wanted|${encodeURIComponent(keyword)}|${offset + RESULTS_PAGE_SIZE}`);
  const title = keyword ? `🔍 نتائج البحث عن طلب شراء "${keyword}":` : "🛍 طلبات شراء معروضة:";
  await bot.api.sendMessage(chatId, `${title}\n\n${lines.join("\n")}`, { reply_markup: kb });
}

// "📂 طلباتي" — a personal view of the current user's own posts, distinct
// from the public browse above (owner spec, 2026-09-06): sellers had no
// way to see their own active listings anywhere before this existed.
async function sendMyWantedListings(bot: TelegramBot, chatId: number, userId: string, offset: number) {
  const wanted = await prisma.storeWantedListing.findMany({
    where: { buyerId: userId },
    orderBy: { created_at: "desc" },
    skip: offset,
    take: RESULTS_PAGE_SIZE,
  });
  if (wanted.length === 0) {
    await bot.api.sendMessage(chatId, offset === 0 ? "😔 لا توجد لديك طلبات شراء منشورة." : "🔚 لا يوجد المزيد من النتائج.", { reply_markup: myOrdersMenu() });
    return;
  }
  const kb = new InlineKeyboard();
  const lines = wanted.map((w, i) => {
    kb.text(`👁 عرض ${i + 1}`, `jview|wanted|${w.id}`).row();
    return `${i + 1}. 🛍 ${w.title}${w.budget ? ` — ميزانية تقريبية: $${w.budget.toFixed(2)}` : ""} — ${orderStatusLabel(w.status)}`;
  });
  if (wanted.length === RESULTS_PAGE_SIZE) kb.text("➡️ 5 نتائج أخرى", `jmore|mywanted||${offset + RESULTS_PAGE_SIZE}`);
  await bot.api.sendMessage(chatId, `🛍 طلبات الشراء الخاصة بك:\n\n${lines.join("\n")}`, { reply_markup: kb });
}
async function sendMyStoreListings(bot: TelegramBot, chatId: number, userId: string, offset: number) {
  const listings = await prisma.storeListing.findMany({
    where: { sellerId: userId },
    orderBy: { created_at: "desc" },
    skip: offset,
    take: RESULTS_PAGE_SIZE,
  });
  if (listings.length === 0) {
    await bot.api.sendMessage(chatId, offset === 0 ? "😔 لا توجد لديك منتجات معروضة." : "🔚 لا يوجد المزيد من النتائج.", { reply_markup: myOrdersMenu() });
    return;
  }
  const kb = new InlineKeyboard();
  const lines = listings.map((l, i) => {
    kb.text(`👁 عرض ${i + 1}`, `jview|listing|${l.id}`).row();
    return `${i + 1}. 🛒 ${l.title} — $${l.price.toFixed(2)} — ${orderStatusLabel(l.status)}`;
  });
  if (listings.length === RESULTS_PAGE_SIZE) kb.text("➡️ 5 نتائج أخرى", `jmore|mylistings||${offset + RESULTS_PAGE_SIZE}`);
  await bot.api.sendMessage(chatId, `💰 منتجاتك المعروضة:\n\n${lines.join("\n")}`, { reply_markup: kb });
}

async function sendJobPostingCard(bot: TelegramBot, chatId: number, id: string, viewerId: string) {
  const p = await prisma.jobPosting.findUnique({ where: { id } });
  if (!p) return;
  if (await isBlocked(viewerId, p.posterId)) {
    await bot.api.sendMessage(chatId, "🚫 غير متاح.");
    return;
  }
  const poster = await prisma.jobsProfile.findUnique({ where: { userId: p.posterId } });
  const contactUrl = p.contactMethod === "TELEGRAM" ? `https://t.me/${p.contactValue.replace(/^@/, "")}` : `https://wa.me/${p.contactValue.replace(/[^0-9]/g, "")}`;
  const text =
    `${roleLabel("EMPLOYER")}${poster ? ` — ${poster.employerBusinessName || poster.name}` : ""}\n\n` +
    `📢 ${p.title}\n📍 ${p.governorate}، ${p.city}\n👥 عدد المطلوب: ${p.workersCount}\n` +
    (p.description ? `📝 ${p.description}\n` : "") + `🏷 ${p.keywords}\n${relativeTime(p.created_at)}`;
  const kb = new InlineKeyboard()
    .url("💬 تواصل", contactUrl).row()
    .text("🚩 إبلاغ", `jreport|posting|${p.posterId}`).text("⛔ حظر", `jblock|${p.posterId}`);
  await bot.api.sendMessage(chatId, text, { reply_markup: kb });
}

async function sendProfessionalCard(bot: TelegramBot, chatId: number, userId: string, viewerId: string) {
  const p = await prisma.jobsProfile.findUnique({ where: { userId } });
  if (!p) return;
  if (await isBlocked(viewerId, userId)) {
    await bot.api.sendMessage(chatId, "🚫 غير متاح.");
    return;
  }
  const contactUrl = p.contactMethod === "TELEGRAM" ? `https://t.me/${p.contactValue.replace(/^@/, "")}` : `https://wa.me/${p.contactValue.replace(/[^0-9]/g, "")}`;
  const text = `${roleLabel("PROFESSIONAL")}\n\n👤 ${p.name}\n🔨 ${p.professionalCategory}\n📍 ${p.governorate}، ${p.city}\n` + (p.professionalDescription ? `📝 ${p.professionalDescription}\n` : "");
  const kb = new InlineKeyboard()
    .url("💬 تواصل", contactUrl).row()
    .text("🚩 إبلاغ", `jreport|profile|${p.userId}`).text("⛔ حظر", `jblock|${p.userId}`);
  await bot.api.sendMessage(chatId, text, { reply_markup: kb });
}

async function sendStoreListingCard(bot: TelegramBot, chatId: number, id: string, viewerId: string) {
  const l = await prisma.storeListing.findUnique({ where: { id } });
  if (!l) return;
  const isOwner = viewerId === l.sellerId;
  if (!isOwner && (await isBlocked(viewerId, l.sellerId))) {
    await bot.api.sendMessage(chatId, "🚫 غير متاح.");
    return;
  }
  const seller = await prisma.jobsProfile.findUnique({ where: { userId: l.sellerId } });
  const text =
    `🛒 حساب: تاجر${seller ? ` — ${seller.name}` : ""}\n\n` +
    `📦 ${l.title}\n💵 السعر المطلوب: $${l.price.toFixed(2)}\n` +
    (l.description ? `📝 ${l.description}\n` : "") +
    `🚚 التسليم: ${l.deliveryMethod === "SHIPPING" ? "شحن (يُتفق عليه بين الطرفين)" : "يدوي (تسليم مباشر)"}\n` +
    `💳 الدفع: ${l.paymentMethod === "ESCROW" ? "عبر البوت (حجز حتى الاستلام)" : "يدوي"}\n` +
    `📌 الحالة: ${orderStatusLabel(l.status)}`;
  const kb = new InlineKeyboard();
  if (isOwner) {
    if (l.status === "ACTIVE" || l.status === "PAUSED") {
      kb.text("✏️ تعديل", `jeditlisting|${l.id}`).row();
      kb.text(l.status === "ACTIVE" ? "⏸ إيقاف" : "▶️ تفعيل", `jtogglelisting|${l.id}`).text("🗑 حذف", `jdeletelisting|${l.id}`);
    }
  } else {
    if (l.status === "ACTIVE") kb.text("🛍 شراء (عرض سعر)", `jbuy|${l.id}`).row();
    kb.text("🚩 إبلاغ", `jreport|listing|${l.sellerId}`).text("⛔ حظر", `jblock|${l.sellerId}`);
  }
  const photoIds = Array.isArray(l.photoFileIds) ? (l.photoFileIds as unknown as string[]) : [];
  if (photoIds.length > 0) {
    await bot.api.sendPhoto(chatId, photoIds[0], { caption: text, reply_markup: kb });
    for (const extra of photoIds.slice(1)) await bot.api.sendPhoto(chatId, extra).catch(() => null);
  } else {
    await bot.api.sendMessage(chatId, text, { reply_markup: kb });
  }
}

async function sendStoreWantedCard(bot: TelegramBot, chatId: number, id: string, viewerId: string) {
  const w = await prisma.storeWantedListing.findUnique({ where: { id } });
  if (!w) return;
  const isOwner = viewerId === w.buyerId;
  if (!isOwner && (await isBlocked(viewerId, w.buyerId))) {
    await bot.api.sendMessage(chatId, "🚫 غير متاح.");
    return;
  }
  const buyer = await prisma.jobsProfile.findUnique({ where: { userId: w.buyerId } });
  const contactUrl = buyer ? (buyer.contactMethod === "TELEGRAM" ? `https://t.me/${buyer.contactValue.replace(/^@/, "")}` : `https://wa.me/${buyer.contactValue.replace(/[^0-9]/g, "")}`) : null;
  const text =
    `🛍 طلب شراء${buyer ? ` — ${buyer.name}` : ""}\n\n📦 ${w.title}\n` +
    (w.description ? `📝 ${w.description}\n` : "") +
    (w.budget ? `💵 الميزانية التقريبية: $${w.budget.toFixed(2)}\n` : "") +
    `📌 الحالة: ${orderStatusLabel(w.status)}\n` +
    relativeTime(w.created_at);
  const kb = new InlineKeyboard();
  if (isOwner) {
    if (w.status === "ACTIVE" || w.status === "PAUSED") {
      kb.text("✏️ تعديل", `jeditwanted|${w.id}`).row();
      kb.text(w.status === "ACTIVE" ? "⏸ إيقاف" : "▶️ تفعيل", `jtogglewanted|${w.id}`).text("🗑 حذف", `jdeletewanted|${w.id}`);
    }
  } else {
    if (w.status === "ACTIVE") kb.text("💰 بيع (تقديم عرض)", `jselloffer|${w.id}`).row();
    if (contactUrl) kb.url("💬 تواصل", contactUrl).row();
    kb.text("🚩 إبلاغ", `jreport|wanted|${w.buyerId}`).text("⛔ حظر", `jblock|${w.buyerId}`);
  }
  await bot.api.sendMessage(chatId, text, { reply_markup: kb });
}

// ---------------------------------------------------------------------
// Store section — بيع / شراء
// ---------------------------------------------------------------------
const STORE_LISTING_STEP_ORDER: StoreListingStep[] = ["title", "description", "price", "photos", "deliveryMethod", "paymentMethod"];
function nextStoreListingStep(step: StoreListingStep): StoreListingStep | null {
  const i = STORE_LISTING_STEP_ORDER.indexOf(step);
  return i >= 0 && i + 1 < STORE_LISTING_STEP_ORDER.length ? STORE_LISTING_STEP_ORDER[i + 1] : null;
}
function deliveryMenu(): Keyboard {
  return new Keyboard().text("🚚 تسليم يدوي").text("📦 شحن").row().text(backLabel()).resized();
}
function paymentMenu(): Keyboard {
  return new Keyboard().text("💳 عبر البوت (حجز آمن)").text("🤝 يدوي").row().text(backLabel()).resized();
}
async function askStoreListingStep(bot: TelegramBot, chatId: number, step: StoreListingStep) {
  switch (step) {
    case "title":
      await bot.api.sendMessage(chatId, "💰 عرض منتج للبيع\n\nما عنوان المنتج؟", { reply_markup: plainBackMenu() });
      break;
    case "description":
      await bot.api.sendMessage(chatId, "صف المنتج (الحالة، التفاصيل...):", { reply_markup: skipMenu() });
      break;
    case "price":
      await bot.api.sendMessage(chatId, "ما السعر بالدولار؟", { reply_markup: plainBackMenu() });
      break;
    case "photos":
      await bot.api.sendMessage(chatId, "أرسل صور المنتج (حتى 5 صور)، ثم اضغط «تم» عند الانتهاء:", {
        reply_markup: new Keyboard().text("✅ تم").row().text(backLabel()).resized(),
      });
      break;
    case "deliveryMethod":
      await bot.api.sendMessage(chatId, "طريقة التسليم؟ (الشحن يُتفق عليه بينك وبين المشتري خارج البوت)", { reply_markup: deliveryMenu() });
      break;
    case "paymentMethod":
      await bot.api.sendMessage(
        chatId,
        "طريقة الدفع؟ «عبر البوت» يحجز المبلغ حتى يؤكد المشتري الاستلام، «يدوي» يكتفي البوت بربطكما لتتفقا مباشرة.",
        { reply_markup: paymentMenu() }
      );
      break;
  }
}
async function startStoreListingWizard(bot: TelegramBot, chatId: number, userId: string, editingId?: string) {
  let photoFileIds: string[] = [];
  if (editingId) {
    const existing = await prisma.storeListing.findUnique({ where: { id: editingId } });
    if (existing) photoFileIds = Array.isArray(existing.photoFileIds) ? (existing.photoFileIds as unknown as string[]) : [];
    if (editingId) await bot.api.sendMessage(chatId, "✏️ تعديل المنتج — أعد إدخال كل الحقول (الصور الحالية تبقى ما لم ترسل صوراً جديدة).");
  }
  await setPending(userId, { mode: "store_listing_wizard", step: "title", data: { photoFileIds }, editingId });
  await askStoreListingStep(bot, chatId, "title");
}
async function consumeStoreListingStep(bot: TelegramBot, chatId: number, userId: string, pending: Extract<PendingAction, { mode: "store_listing_wizard" }>, text: string) {
  const { step, data } = pending;
  if (step === "title") {
    if (!text) return;
    data.title = text;
  } else if (step === "description") {
    data.description = isSkip(text) ? undefined : text;
  } else if (step === "price") {
    const price = Number(text.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(price) || price <= 0) {
      await bot.api.sendMessage(chatId, "أرسل سعراً صحيحاً.");
      return;
    }
    data.price = price;
  } else if (step === "photos") {
    if (text !== "✅ تم") {
      await bot.api.sendMessage(chatId, "أرسل صورة، أو اضغط «✅ تم».");
      return;
    }
  } else if (step === "deliveryMethod") {
    if (text !== "🚚 تسليم يدوي" && text !== "📦 شحن") {
      await bot.api.sendMessage(chatId, "اختر من القائمة.", { reply_markup: deliveryMenu() });
      return;
    }
    data.deliveryMethod = text === "📦 شحن" ? "SHIPPING" : "PICKUP_MANUAL";
  } else if (step === "paymentMethod") {
    if (text !== "💳 عبر البوت (حجز آمن)" && text !== "🤝 يدوي") {
      await bot.api.sendMessage(chatId, "اختر من القائمة.", { reply_markup: paymentMenu() });
      return;
    }
    data.paymentMethod = text === "🤝 يدوي" ? "MANUAL" : "ESCROW";
  }

  const next = nextStoreListingStep(step);
  if (!next) {
    const fields = {
      title: data.title!, description: data.description ?? null, price: data.price!,
      photoFileIds: data.photoFileIds as any, deliveryMethod: data.deliveryMethod!, paymentMethod: data.paymentMethod!,
    };
    if (pending.editingId) {
      await prisma.storeListing.update({ where: { id: pending.editingId }, data: fields });
      await setPending(userId, null);
      await bot.api.sendMessage(chatId, "✅ تم تحديث منتجك.", { reply_markup: mainMenu() });
      return;
    }
    await prisma.storeListing.create({ data: { sellerId: userId, ...fields } });
    await setPending(userId, null);
    await bot.api.sendMessage(chatId, "✅ تم نشر المنتج في المتجر.", { reply_markup: mainMenu() });
    return;
  }
  await setPending(userId, { mode: "store_listing_wizard", step: next, data, editingId: pending.editingId });
  await askStoreListingStep(bot, chatId, next);
}

const STORE_WANTED_STEP_ORDER: StoreWantedStep[] = ["title", "description", "budget"];
function nextStoreWantedStep(step: StoreWantedStep): StoreWantedStep | null {
  const i = STORE_WANTED_STEP_ORDER.indexOf(step);
  return i >= 0 && i + 1 < STORE_WANTED_STEP_ORDER.length ? STORE_WANTED_STEP_ORDER[i + 1] : null;
}
async function askStoreWantedStep(bot: TelegramBot, chatId: number, step: StoreWantedStep) {
  switch (step) {
    case "title":
      await bot.api.sendMessage(chatId, "🛍 أريد شراء\n\nماذا تريد أن تشتري؟", { reply_markup: plainBackMenu() });
      break;
    case "description":
      await bot.api.sendMessage(chatId, "أضف تفاصيل (اختياري):", { reply_markup: skipMenu() });
      break;
    case "budget":
      await bot.api.sendMessage(chatId, "ميزانيتك التقريبية بالدولار (اختياري):", { reply_markup: skipMenu() });
      break;
  }
}
async function startStoreWantedWizard(bot: TelegramBot, chatId: number, userId: string, editingId?: string) {
  if (editingId) await bot.api.sendMessage(chatId, "✏️ تعديل الطلب — أعد إدخال كل الحقول.");
  await setPending(userId, { mode: "store_wanted_wizard", step: "title", data: {}, editingId });
  await askStoreWantedStep(bot, chatId, "title");
}
async function consumeStoreWantedStep(bot: TelegramBot, chatId: number, userId: string, pending: Extract<PendingAction, { mode: "store_wanted_wizard" }>, text: string) {
  const { step, data } = pending;
  if (step === "title") {
    if (!text) return;
    data.title = text;
  } else if (step === "description") {
    data.description = isSkip(text) ? undefined : text;
  } else if (step === "budget") {
    data.budget = isSkip(text) ? null : Number(text.replace(/[^0-9.]/g, "")) || null;
  }
  const next = nextStoreWantedStep(step);
  if (!next) {
    const fields = { title: data.title!, description: data.description ?? null, budget: data.budget ?? null };
    if (pending.editingId) {
      await prisma.storeWantedListing.update({ where: { id: pending.editingId }, data: fields });
      await setPending(userId, null);
      await bot.api.sendMessage(chatId, "✅ تم تحديث طلبك.", { reply_markup: mainMenu() });
      return;
    }
    await prisma.storeWantedListing.create({ data: { buyerId: userId, ...fields } });
    await setPending(userId, null);
    await bot.api.sendMessage(chatId, "✅ تم نشر طلبك في المتجر.", { reply_markup: mainMenu() });
    return;
  }
  await setPending(userId, { mode: "store_wanted_wizard", step: next, data, editingId: pending.editingId });
  await askStoreWantedStep(bot, chatId, next);
}

// ---------------------------------------------------------------------
// StoreOffer — price negotiation, either side can initiate (owner spec,
// 2026-09-06): a buyer proposes a price on someone's StoreListing, or a
// seller proposes to fulfill someone's StoreWantedListing. buyerId/
// sellerId on the offer are fixed roles; price/lastOfferBy move as either
// side counters. Accepting always executes at the CURRENT price.
// ---------------------------------------------------------------------
function receivedDisputeKeyboard(orderId: string): InlineKeyboard {
  return new InlineKeyboard().text("✅ لقد استلمت المنتج", `jreceived|${orderId}`).row().text("⚠️ فتح نزاع", `jdispute|${orderId}`);
}

async function startOffer(bot: TelegramBot, chatId: number, initiatorId: string, kind: "LISTING" | "WANTED", targetId: string) {
  if (kind === "LISTING") {
    const listing = await prisma.storeListing.findUnique({ where: { id: targetId } });
    if (!listing || listing.status !== "ACTIVE") {
      await bot.api.sendMessage(chatId, "لم يعد هذا المنتج متاحاً.");
      return;
    }
    if (listing.sellerId === initiatorId) {
      await bot.api.sendMessage(chatId, "لا يمكنك تقديم عرض على منتجك الخاص.");
      return;
    }
    if (await isBlocked(initiatorId, listing.sellerId)) {
      await bot.api.sendMessage(chatId, "🚫 لا يمكن إتمام هذا الطلب.");
      return;
    }
    await setPending(initiatorId, { mode: "offer_price", kind: "LISTING", targetId });
    await bot.api.sendMessage(chatId, `💰 أدخل السعر الذي تعرضه بالدولار (السعر المطلوب من البائع: $${listing.price.toFixed(2)}):`, { reply_markup: plainBackMenu() });
    return;
  }
  const wanted = await prisma.storeWantedListing.findUnique({ where: { id: targetId } });
  if (!wanted || wanted.status !== "ACTIVE") {
    await bot.api.sendMessage(chatId, "لم يعد هذا الطلب متاحاً.");
    return;
  }
  if (wanted.buyerId === initiatorId) {
    await bot.api.sendMessage(chatId, "لا يمكنك تقديم عرض على طلبك الخاص.");
    return;
  }
  if (await isBlocked(initiatorId, wanted.buyerId)) {
    await bot.api.sendMessage(chatId, "🚫 لا يمكن إتمام هذا الطلب.");
    return;
  }
  await setPending(initiatorId, { mode: "offer_price", kind: "WANTED", targetId });
  await bot.api.sendMessage(
    chatId,
    `💰 أدخل السعر الذي تعرضه بالدولار${wanted.budget ? ` (ميزانية الطالب التقريبية: $${wanted.budget.toFixed(2)})` : ""}:`,
    { reply_markup: plainBackMenu() }
  );
}

async function notifyOfferToOtherParty(bot: TelegramBot, offer: { id: string; kind: string; listingId: string | null; wantedId: string | null; buyerId: string; sellerId: string; price: number; lastOfferBy: string }) {
  const title =
    offer.kind === "LISTING"
      ? (await prisma.storeListing.findUnique({ where: { id: offer.listingId! } }))?.title
      : (await prisma.storeWantedListing.findUnique({ where: { id: offer.wantedId! } }))?.title;
  const otherPartyId = offer.lastOfferBy === offer.buyerId ? offer.sellerId : offer.buyerId;
  const proposerLabel = offer.lastOfferBy === offer.buyerId ? "المشتري" : "البائع";
  const kb = new InlineKeyboard()
    .text("✅ قبول", `joffer_accept|${offer.id}`).text("❌ رفض", `joffer_reject|${offer.id}`).row()
    .text("💬 تفاوض (سعر آخر)", `joffer_negotiate|${offer.id}`);
  await bot.api
    .sendMessage(Number(otherPartyId), `💰 عرض سعر على "${title}": $${offer.price.toFixed(2)} من ${proposerLabel} (#${shortId(offer.lastOfferBy)})`, { reply_markup: kb })
    .catch(() => null);
}

async function submitOfferPrice(bot: TelegramBot, chatId: number, userId: string, kind: "LISTING" | "WANTED", targetId: string, price: number) {
  let offer;
  if (kind === "LISTING") {
    const listing = await prisma.storeListing.findUnique({ where: { id: targetId } });
    if (!listing || listing.status !== "ACTIVE") {
      await bot.api.sendMessage(chatId, "لم يعد هذا المنتج متاحاً.", { reply_markup: mainMenu() });
      return;
    }
    offer = await prisma.storeOffer.create({ data: { kind: "LISTING", listingId: listing.id, buyerId: userId, sellerId: listing.sellerId, price, lastOfferBy: userId } });
  } else {
    const wanted = await prisma.storeWantedListing.findUnique({ where: { id: targetId } });
    if (!wanted || wanted.status !== "ACTIVE") {
      await bot.api.sendMessage(chatId, "لم يعد هذا الطلب متاحاً.", { reply_markup: mainMenu() });
      return;
    }
    offer = await prisma.storeOffer.create({ data: { kind: "WANTED", wantedId: wanted.id, buyerId: wanted.buyerId, sellerId: userId, price, lastOfferBy: userId } });
  }
  await bot.api.sendMessage(chatId, `✅ تم إرسال عرضك بسعر $${price.toFixed(2)}. سننتظر رد الطرف الآخر.`, { reply_markup: mainMenu() });
  await notifyOfferToOtherParty(bot, offer);
}

async function respondOffer(bot: TelegramBot, chatId: number, userId: string, offerId: string, action: "accept" | "reject") {
  const offer = await prisma.storeOffer.findUnique({ where: { id: offerId } });
  if (!offer || offer.status !== "PENDING") {
    await bot.api.sendMessage(chatId, "هذا العرض لم يعد متاحاً.");
    return;
  }
  const otherPartyId = offer.lastOfferBy === offer.buyerId ? offer.sellerId : offer.buyerId;
  if (userId !== otherPartyId) {
    await bot.api.sendMessage(chatId, "ليس لديك صلاحية الرد على هذا العرض.");
    return;
  }
  if (action === "reject") {
    await prisma.storeOffer.update({ where: { id: offer.id }, data: { status: "REJECTED" } });
    await bot.api.sendMessage(chatId, "❌ تم رفض العرض.");
    await bot.api.sendMessage(Number(offer.lastOfferBy), `❌ تم رفض عرضك بسعر $${offer.price.toFixed(2)}.`).catch(() => null);
    return;
  }
  await finalizeAcceptedOffer(bot, offer);
}

async function startNegotiate(bot: TelegramBot, chatId: number, userId: string, offerId: string) {
  const offer = await prisma.storeOffer.findUnique({ where: { id: offerId } });
  if (!offer || offer.status !== "PENDING") {
    await bot.api.sendMessage(chatId, "هذا العرض لم يعد متاحاً.");
    return;
  }
  const otherPartyId = offer.lastOfferBy === offer.buyerId ? offer.sellerId : offer.buyerId;
  if (userId !== otherPartyId) {
    await bot.api.sendMessage(chatId, "ليس لديك صلاحية التفاوض على هذا العرض.");
    return;
  }
  await setPending(userId, { mode: "offer_counter", offerId });
  await bot.api.sendMessage(chatId, `💬 أدخل السعر الذي تقترحه بالدولار (السعر الحالي: $${offer.price.toFixed(2)}):`, { reply_markup: plainBackMenu() });
}

async function submitOfferCounter(bot: TelegramBot, chatId: number, userId: string, offerId: string, price: number) {
  const offer = await prisma.storeOffer.findUnique({ where: { id: offerId } });
  if (!offer || offer.status !== "PENDING") {
    await bot.api.sendMessage(chatId, "هذا العرض لم يعد متاحاً.", { reply_markup: mainMenu() });
    return;
  }
  const otherPartyId = offer.lastOfferBy === offer.buyerId ? offer.sellerId : offer.buyerId;
  if (userId !== otherPartyId) {
    await bot.api.sendMessage(chatId, "ليس لديك صلاحية التفاوض على هذا العرض.", { reply_markup: mainMenu() });
    return;
  }
  const updated = await prisma.storeOffer.update({ where: { id: offer.id }, data: { price, lastOfferBy: userId } });
  await bot.api.sendMessage(chatId, `✅ تم إرسال عرضك المقابل بسعر $${price.toFixed(2)}.`, { reply_markup: mainMenu() });
  await notifyOfferToOtherParty(bot, updated);
}

async function finalizeAcceptedOffer(bot: TelegramBot, offer: { id: string; kind: string; listingId: string | null; wantedId: string | null; buyerId: string; sellerId: string; price: number }) {
  if (offer.kind === "LISTING") {
    const listing = await prisma.storeListing.findUnique({ where: { id: offer.listingId! } });
    if (!listing || listing.status !== "ACTIVE") {
      await prisma.storeOffer.update({ where: { id: offer.id }, data: { status: "REJECTED" } });
      await bot.api.sendMessage(Number(offer.buyerId), "❌ لم يعد هذا الاتفاق ممكناً — المنتج لم يعد متاحاً.").catch(() => null);
      await bot.api.sendMessage(Number(offer.sellerId), "❌ لم يعد هذا الاتفاق ممكناً — المنتج لم يعد متاحاً.").catch(() => null);
      return;
    }
    if (listing.paymentMethod === "MANUAL") {
      await prisma.storeOffer.update({ where: { id: offer.id }, data: { status: "ACCEPTED" } });
      const seller = await prisma.jobsProfile.findUnique({ where: { userId: listing.sellerId } });
      const buyer = await prisma.jobsProfile.findUnique({ where: { userId: offer.buyerId } });
      const sellerContact = seller ? (seller.contactMethod === "TELEGRAM" ? `https://t.me/${seller.contactValue.replace(/^@/, "")}` : `https://wa.me/${seller.contactValue.replace(/[^0-9]/g, "")}`) : null;
      const buyerContact = buyer ? (buyer.contactMethod === "TELEGRAM" ? `https://t.me/${buyer.contactValue.replace(/^@/, "")}` : `https://wa.me/${buyer.contactValue.replace(/[^0-9]/g, "")}`) : null;
      await bot.api.sendMessage(Number(offer.buyerId), `🤝 تم الاتفاق على السعر $${offer.price.toFixed(2)} — هذا المنتج دفعه يدوي، تواصل مع البائع لإتمام الصفقة.${sellerContact ? `\n${sellerContact}` : ""}`, { reply_markup: mainMenu() }).catch(() => null);
      await bot.api.sendMessage(Number(offer.sellerId), `🤝 تم الاتفاق على السعر $${offer.price.toFixed(2)} — تواصل مع المشتري لإتمام الصفقة يدوياً.${buyerContact ? `\n${buyerContact}` : ""}`, { reply_markup: mainMenu() }).catch(() => null);
      return;
    }
    const charge = await chargeJobsUser(offer.buyerId, offer.price, "ESCROW_HOLD");
    if (!charge.ok) {
      await prisma.storeOffer.update({ where: { id: offer.id }, data: { status: "REJECTED" } });
      await bot.api.sendMessage(Number(offer.sellerId), "❌ لم يكتمل الاتفاق — رصيد المشتري غير كافٍ حالياً.").catch(() => null);
      await bot.api.sendMessage(Number(offer.buyerId), `❌ قُبل عرضك لكن رصيدك $${charge.balance.toFixed(2)} لا يكفي (السعر $${offer.price.toFixed(2)}). أودِع ثم قدّم عرضاً جديداً:\n${depositLink(offer.buyerId)}`, { reply_markup: mainMenu() }).catch(() => null);
      return;
    }
    const order = await prisma.storeOrder.create({
      data: { buyerId: offer.buyerId, sellerId: listing.sellerId, listingId: listing.id, amount: offer.price, deliveryMethod: listing.deliveryMethod, status: "ESCROWED", escrowedAt: new Date() },
    });
    await prisma.storeListing.update({ where: { id: listing.id }, data: { status: "SOLD" } });
    await prisma.storeOffer.update({ where: { id: offer.id }, data: { status: "ACCEPTED" } });
    await bot.api.sendMessage(
      Number(offer.buyerId),
      `✅ تم قبول عرضك بسعر $${offer.price.toFixed(2)} على "${listing.title}"! تم حجز المبلغ من رصيدك. تواصل مع البائع لترتيب التسليم، واضغط الزر أدناه فقط بعد استلام المنتج فعلياً.`,
      { reply_markup: receivedDisputeKeyboard(order.id) }
    ).catch(() => null);
    await bot.api
      .sendMessage(Number(offer.sellerId), `✅ قبلت عرضاً بسعر $${offer.price.toFixed(2)} على "${listing.title}" — تم حجز المبلغ من المشتري. رتّب التسليم معه، وسيتحرر المبلغ عند تأكيده الاستلام.`)
      .catch(() => null);
    return;
  }

  // kind === "WANTED" — there is no pre-existing StoreListing, so one is
  // synthesized here purely so the existing escrow/dispute/auto-release
  // pipeline (all driven off StoreOrder.listingId) keeps working unchanged.
  const wanted = await prisma.storeWantedListing.findUnique({ where: { id: offer.wantedId! } });
  if (!wanted || wanted.status !== "ACTIVE") {
    await prisma.storeOffer.update({ where: { id: offer.id }, data: { status: "REJECTED" } });
    await bot.api.sendMessage(Number(offer.buyerId), "❌ لم يعد هذا الاتفاق ممكناً — الطلب لم يعد متاحاً.").catch(() => null);
    await bot.api.sendMessage(Number(offer.sellerId), "❌ لم يعد هذا الاتفاق ممكناً — الطلب لم يعد متاحاً.").catch(() => null);
    return;
  }
  const charge = await chargeJobsUser(offer.buyerId, offer.price, "ESCROW_HOLD");
  if (!charge.ok) {
    await prisma.storeOffer.update({ where: { id: offer.id }, data: { status: "REJECTED" } });
    await bot.api.sendMessage(Number(offer.sellerId), "❌ لم يكتمل الاتفاق — رصيد المشتري غير كافٍ حالياً.").catch(() => null);
    await bot.api.sendMessage(Number(offer.buyerId), `❌ قُبل عرضك لكن رصيدك $${charge.balance.toFixed(2)} لا يكفي (السعر $${offer.price.toFixed(2)}). أودِع ثم قدّم عرضاً جديداً:\n${depositLink(offer.buyerId)}`, { reply_markup: mainMenu() }).catch(() => null);
    return;
  }
  const listing = await prisma.storeListing.create({
    data: { sellerId: offer.sellerId, title: wanted.title, description: wanted.description, price: offer.price, photoFileIds: [], deliveryMethod: "PICKUP_MANUAL", paymentMethod: "ESCROW", status: "SOLD" },
  });
  const order = await prisma.storeOrder.create({
    data: { buyerId: offer.buyerId, sellerId: offer.sellerId, listingId: listing.id, amount: offer.price, deliveryMethod: "PICKUP_MANUAL", status: "ESCROWED", escrowedAt: new Date() },
  });
  await prisma.storeWantedListing.update({ where: { id: wanted.id }, data: { status: "FULFILLED" } });
  await prisma.storeOffer.update({ where: { id: offer.id }, data: { status: "ACCEPTED" } });
  await bot.api.sendMessage(
    Number(offer.buyerId),
    `✅ تم الاتفاق على تلبية طلبك "${wanted.title}" بسعر $${offer.price.toFixed(2)}. تم حجز المبلغ من رصيدك. تواصل مع البائع لترتيب التسليم، واضغط الزر أدناه فقط بعد استلام المنتج فعلياً.`,
    { reply_markup: receivedDisputeKeyboard(order.id) }
  ).catch(() => null);
  await bot.api
    .sendMessage(Number(offer.sellerId), `✅ قُبل عرضك لتلبية طلب "${wanted.title}" بسعر $${offer.price.toFixed(2)} — تم حجز المبلغ من المشتري. رتّب التسليم معه، وسيتحرر المبلغ عند تأكيده الاستلام.`)
    .catch(() => null);
}

async function confirmReceived(bot: TelegramBot, chatId: number, buyerId: string, orderId: string) {
  const order = await prisma.storeOrder.findUnique({ where: { id: orderId } });
  if (!order || order.buyerId !== buyerId || order.status !== "ESCROWED") {
    await bot.api.sendMessage(chatId, "هذا الطلب غير متاح لهذا الإجراء.");
    return;
  }
  await creditJobsUser(order.sellerId, order.amount, "ESCROW_RELEASE");
  await prisma.storeOrder.update({ where: { id: order.id }, data: { status: "RELEASED", releasedAt: new Date() } });
  await bot.api.sendMessage(chatId, "✅ تم تأكيد الاستلام وتحويل المبلغ للبائع.", { reply_markup: mainMenu() });
  await bot.api.sendMessage(Number(order.sellerId), `✅ أكّد المشتري استلام طلبه — تم إضافة $${order.amount.toFixed(2)} لرصيدك.`).catch(() => null);
}

// ---------------------------------------------------------------------
// Dispute center — each side submits evidence separately
// ---------------------------------------------------------------------
async function openDispute(bot: TelegramBot, chatId: number, userId: string, orderId: string) {
  const order = await prisma.storeOrder.findUnique({ where: { id: orderId } });
  if (!order || order.status !== "ESCROWED" || (order.buyerId !== userId && order.sellerId !== userId)) {
    await bot.api.sendMessage(chatId, "لا يمكن فتح نزاع على هذا الطلب.");
    return;
  }
  await prisma.jobsDispute.upsert({
    where: { orderId },
    update: {},
    create: { orderId, openedBy: userId },
  });
  const side = order.buyerId === userId ? "buyer" : "seller";
  await setPending(userId, { mode: "dispute_statement", orderId, side });
  const otherSide = side === "buyer" ? order.sellerId : order.buyerId;
  await bot.api.sendMessage(chatId, "⚠️ تم فتح نزاع. اكتب إفادتك بخصوص هذا الطلب (ما حدث بالتفصيل):", { reply_markup: plainBackMenu() });
  await bot.api
    .sendMessage(Number(otherSide), `⚠️ فتح الطرف الآخر نزاعاً على طلب بقيمة $${order.amount.toFixed(2)}. سيُطلب منك إفادتك أيضاً.`, {
      reply_markup: new InlineKeyboard().text("📝 تقديم إفادتي", `jdisputestate|${orderId}`),
    })
    .catch(() => null);
}
async function submitDisputeStatement(bot: TelegramBot, chatId: number, userId: string, orderId: string, side: "buyer" | "seller", statement: string) {
  await setPending(userId, { mode: "dispute_evidence", orderId, side, statement });
  await bot.api.sendMessage(chatId, "أرسل صورة كدليل إن وُجدت، أو اضغط «تخطّي»:", { reply_markup: skipMenu() });
}
async function submitDisputeEvidence(bot: TelegramBot, chatId: number, userId: string, orderId: string, side: "buyer" | "seller", statement: string, photoFileId: string | null) {
  const field = side === "buyer" ? { buyerStatement: statement, buyerEvidencePhotoIds: photoFileId ? [photoFileId] : [] } : { sellerStatement: statement, sellerEvidencePhotoIds: photoFileId ? [photoFileId] : [] };
  const dispute = await prisma.jobsDispute.update({ where: { orderId }, data: field as any });
  const bothIn = !!dispute.buyerStatement && !!dispute.sellerStatement;
  if (bothIn) await prisma.jobsDispute.update({ where: { orderId }, data: { status: "BOTH_SUBMITTED" } });
  await setPending(userId, null);
  await bot.api.sendMessage(chatId, "✅ تم إرسال إفادتك للإدارة.", { reply_markup: mainMenu() });
  if (bothIn && SUPER_ADMIN_ID) {
    const order = await prisma.storeOrder.findUnique({ where: { id: orderId } });
    await bot.api
      .sendMessage(
        Number(SUPER_ADMIN_ID),
        `⚠️ نزاع جاهز للمراجعة — طلب #${shortId(orderId)} بقيمة $${order?.amount.toFixed(2)}\n\n` +
          `🟦 المشتري (#${shortId(order?.buyerId || "")}):\n${dispute.buyerStatement}\n\n` +
          `🟥 البائع (#${shortId(order?.sellerId || "")}):\n${dispute.sellerStatement}`,
        { reply_markup: new InlineKeyboard().text("✅ الإفراج للبائع", `jresolve|${orderId}|seller`).text("↩️ استرداد للمشتري", `jresolve|${orderId}|buyer`) }
      )
      .catch(() => null);
  }
}
async function resolveDispute(bot: TelegramBot, chatId: number, orderId: string, winner: "buyer" | "seller") {
  const order = await prisma.storeOrder.findUnique({ where: { id: orderId } });
  if (!order || order.status !== "ESCROWED") {
    await bot.api.sendMessage(chatId, "هذا الطلب لم يعد بحالة نزاع نشطة.");
    return;
  }
  if (winner === "seller") {
    await creditJobsUser(order.sellerId, order.amount, "ESCROW_RELEASE");
  } else {
    await creditJobsUser(order.buyerId, order.amount, "ESCROW_REFUND");
  }
  await prisma.storeOrder.update({ where: { id: order.id }, data: { status: winner === "seller" ? "RELEASED" : "REFUNDED", releasedAt: new Date() } });
  await prisma.jobsDispute.update({ where: { orderId }, data: { status: "RESOLVED", resolution: winner === "seller" ? "RELEASED_TO_SELLER" : "REFUNDED_TO_BUYER", resolvedAt: new Date() } });
  await bot.api.sendMessage(chatId, "✅ تم تنفيذ القرار.");
  await bot.api.sendMessage(Number(order.buyerId), winner === "buyer" ? "✅ تم استرداد مبلغ طلبك بعد مراجعة النزاع." : "❌ تقرر تحويل مبلغ الطلب للبائع بعد مراجعة النزاع.").catch(() => null);
  await bot.api.sendMessage(Number(order.sellerId), winner === "seller" ? "✅ تم تحويل مبلغ الطلب لرصيدك بعد مراجعة النزاع." : "❌ تقرر استرداد مبلغ الطلب للمشتري بعد مراجعة النزاع.").catch(() => null);
}

// ---------------------------------------------------------------------
// Admin panel
// ---------------------------------------------------------------------
async function sendAdminStats(bot: TelegramBot, chatId: number) {
  const notAdmin = { id: { not: SUPER_ADMIN_ID || "__none__" } };
  const [totalUsers, seekers, employers, professionals, traders, openPostings, activeListings, escrowedOrders, openDisputes, pendingReports, pendingInbox] = await Promise.all([
    prisma.jobsUser.count({ where: notAdmin }),
    prisma.jobsProfile.count({ where: { roleType: "SEEKER" } }),
    prisma.jobsProfile.count({ where: { roleType: "EMPLOYER" } }),
    prisma.jobsProfile.count({ where: { roleType: "PROFESSIONAL" } }),
    prisma.jobsProfile.count({ where: { roleType: "TRADER" } }),
    prisma.jobPosting.count({ where: { status: "OPEN" } }),
    prisma.storeListing.count({ where: { status: "ACTIVE" } }),
    prisma.storeOrder.count({ where: { status: "ESCROWED" } }),
    prisma.jobsDispute.count({ where: { status: { not: "RESOLVED" } } }),
    prisma.jobsReport.count({ where: { status: "PENDING" } }),
    prisma.jobsAdminMessage.count({ where: { status: "PENDING" } }),
  ]);
  const text =
    `📊 إحصائيات بوت فرص العمل\n\n👥 إجمالي المستخدمين: ${totalUsers}\n` +
    `👷 باحثون: ${seekers} | 🏢 معلنو وظائف: ${employers} | 🔨 مهنيون: ${professionals} | 🛒 تجار: ${traders}\n\n` +
    `📢 وظائف شاغرة مفتوحة: ${openPostings}\n🛒 منتجات معروضة: ${activeListings}\n💰 طلبات محجوزة حالياً: ${escrowedOrders}\n\n` +
    `⚠️ نزاعات مفتوحة: ${openDisputes}\n🚩 بلاغات معلّقة: ${pendingReports}\n📥 رسائل واردة غير مقروءة: ${pendingInbox}`;
  await bot.api.sendMessage(chatId, text);
}
async function sendAdminInboxSummary(bot: TelegramBot, chatId: number) {
  const [messages, reports, disputes] = await Promise.all([
    prisma.jobsAdminMessage.findMany({ where: { status: "PENDING" }, orderBy: { created_at: "asc" }, take: 10 }),
    prisma.jobsReport.findMany({ where: { status: "PENDING" }, orderBy: { created_at: "asc" }, take: 10 }),
    prisma.jobsDispute.findMany({ where: { status: { not: "RESOLVED" } }, orderBy: { created_at: "asc" }, take: 10 }),
  ]);
  if (messages.length === 0 && reports.length === 0 && disputes.length === 0) {
    await bot.api.sendMessage(chatId, "✅ لا توجد رسائل أو بلاغات أو نزاعات بانتظار المراجعة.");
    return;
  }
  for (const m of messages) {
    await bot.api
      .sendMessage(chatId, `📩 رسالة من #${shortId(m.senderId)}\n${relativeTime(m.created_at)}\n\n${m.text}`, {
        reply_markup: new InlineKeyboard().text("↩️ رد", `jadmin_reply|${m.senderId}|${m.id}`).text("✅ مقروءة", `jadmin_read|${m.id}`),
      })
      .catch(() => null);
  }
  for (const r of reports) {
    const kindLabel = r.targetKind === "listing" ? "منتج" : r.targetKind === "posting" ? "وظيفة" : r.targetKind === "wanted" ? "طلب شراء" : "ملف";
    const text = `🚩 بلاغ من #${shortId(r.reporterId)} ضد #${shortId(r.targetId)} (${kindLabel})\n${relativeTime(r.created_at)}\n\nالسبب: ${r.reason}`;
    const kb = new InlineKeyboard()
      .text("🙈 تجاهل", `jrep_ignore|${r.id}`).row()
      .text("🔇 كتم 24 ساعة", `jrep_mute|${r.id}|${r.targetId}`).text("⛔ حظر المُبلَّغ عنه", `jrep_ban|${r.id}|${r.targetId}`);
    if (r.evidencePhotoFileId) await bot.api.sendPhoto(chatId, r.evidencePhotoFileId, { caption: text, reply_markup: kb }).catch(() => null);
    else await bot.api.sendMessage(chatId, text, { reply_markup: kb }).catch(() => null);
  }
  for (const d of disputes) {
    const order = await prisma.storeOrder.findUnique({ where: { id: d.orderId } });
    const stageNote = d.status === "BOTH_SUBMITTED" ? "" : "\n\n⏳ لم يقدّم الطرفان إفادتهما بعد بالكامل — القرار أدناه سيُنفَّذ بما هو متاح إن اخترت عدم الانتظار أكثر.";
    await bot.api
      .sendMessage(
        chatId,
        `⚠️ نزاع طلب #${shortId(d.orderId)} — $${order?.amount.toFixed(2)}\n\n` +
          `🟦 المشتري:\n${d.buyerStatement || "(لم يقدّم إفادته بعد)"}\n\n` +
          `🟥 البائع:\n${d.sellerStatement || "(لم يقدّم إفادته بعد)"}` +
          stageNote,
        { reply_markup: new InlineKeyboard().text("✅ الإفراج للبائع", `jresolve|${d.orderId}|seller`).text("↩️ استرداد للمشتري", `jresolve|${d.orderId}|buyer`) }
      )
      .catch(() => null);
  }
}

// ---------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------
export async function handleJobsBotUpdate(bot: TelegramBot, botRow: BotRow, update: any) {
  if (update.callback_query) {
    await handleJobsCallback(bot, botRow, update.callback_query);
    return;
  }
  const msg = update.message;
  if (!msg?.from || !msg.chat) return;
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);

  if (SUPER_ADMIN_ID && tgUserId === SUPER_ADMIN_ID) {
    const text = String(msg.text || "").trim();
    const adminUser = await ensureJobsUser(botRow.id, tgUserId);
    const adminPending = adminUser.pendingAction as PendingAction | null;
    if (text === "/start") {
      await setPending(tgUserId, null);
      await bot.api.sendMessage(chatId, "🛠 لوحة تحكم بوت فرص العمل.", { reply_markup: adminMenu() });
      return;
    }
    if (adminPending?.mode === "admin_broadcast" && text) {
      await setPending(tgUserId, null);
      const recipients = await prisma.jobsUser.findMany({ where: { id: { not: SUPER_ADMIN_ID } }, select: { id: true } });
      let sent = 0;
      for (const r of recipients) {
        try {
          await bot.api.sendMessage(Number(r.id), `📢 إعلان من الإدارة:\n\n${text}`);
          sent++;
        } catch {}
      }
      await bot.api.sendMessage(chatId, `✅ تم الإرسال إلى ${sent} من أصل ${recipients.length}.`);
      return;
    }
    if (adminPending?.mode === "admin_lookup" && text) {
      await setPending(tgUserId, null);
      const targetId = text.replace(/[^0-9]/g, "");
      const profile = await prisma.jobsProfile.findUnique({ where: { userId: targetId } });
      const user = await prisma.jobsUser.findUnique({ where: { id: targetId } });
      if (!user) {
        await bot.api.sendMessage(chatId, "لم يتم العثور على مستخدم بهذا الآيدي.");
        return;
      }
      const [listingsCount, wantedCount, postingsCount, reportsAgainst] = await Promise.all([
        prisma.storeListing.count({ where: { sellerId: targetId, status: { in: ["ACTIVE", "PAUSED"] } } }),
        prisma.storeWantedListing.count({ where: { buyerId: targetId, status: { in: ["ACTIVE", "PAUSED"] } } }),
        prisma.jobPosting.count({ where: { posterId: targetId, status: "OPEN" } }),
        prisma.jobsReport.count({ where: { targetId } }),
      ]);
      const muted = user.mutedUntil && user.mutedUntil > new Date();
      let profileBlock = "لا يوجد ملف شخصي.";
      if (profile) {
        profileBlock =
          `${roleLabel(profile.roleType)}\nالاسم: ${profile.name}، ${profile.age}\n🌍 ${profile.country}، ${profile.governorate}، ${profile.city}\n` +
          `📞 ${profile.contactMethod === "TELEGRAM" ? "تلجرام" : "واتساب"}: ${profile.contactValue}\n` +
          (profile.seekerProfession ? `💼 يبحث عن: ${profile.seekerProfession}\n` : "") +
          (profile.employerBusinessName ? `🏢 ${profile.employerBusinessName}\n` : "") +
          (profile.professionalCategory ? `🔨 ${profile.professionalCategory}${profile.professionalDescription ? ` — ${profile.professionalDescription}` : ""}\n` : "") +
          `⏸ الملف موقوف: ${profile.isPaused ? "نعم" : "لا"}`;
      }
      await bot.api.sendMessage(
        chatId,
        `🆔 ${targetId}\n💰 الرصيد: $${user.balance.toFixed(2)}\n📱 تحقق الهاتف: ${user.phoneVerified ? "✅" : "❌"}\n` +
          `🚫 محظور: ${user.isBanned ? "نعم" : "لا"}\n🔇 مكتوم: ${muted ? `نعم حتى ${user.mutedUntil!.toLocaleString("ar")}` : "لا"}\n` +
          `🚩 بلاغات ضده: ${reportsAgainst}\n📦 منتجات نشطة: ${listingsCount} | 🛍 طلبات شراء نشطة: ${wantedCount} | 📢 وظائف مفتوحة: ${postingsCount}\n\n` +
          profileBlock,
        { reply_markup: new InlineKeyboard().text(user.isBanned ? "🔓 رفع الحظر" : "⛔ حظر", `jadmin_toggleban|${targetId}`) }
      );
      return;
    }
    if (adminPending?.mode === "admin_unban" && text) {
      await setPending(tgUserId, null);
      const targetId = text.replace(/[^0-9]/g, "");
      await prisma.jobsUser.update({ where: { id: targetId }, data: { isBanned: false, mutedUntil: null } }).catch(() => null);
      await bot.api.sendMessage(chatId, `✅ تم رفع الحظر/الكتم عن ${targetId}.`);
      await bot.api.sendMessage(Number(targetId), "✅ تم رفع الحظر/الكتم عنك من قِبل الإدارة، يمكنك استخدام البوت الآن.").catch(() => null);
      return;
    }
    if (adminPending?.mode === "admin_channel" && text) {
      await setPending(tgUserId, null);
      await prisma.bot.update({ where: { id: botRow.id }, data: { requiredChannel: isSkip(text) ? null : text.replace(/^@/, "") } });
      await bot.api.sendMessage(chatId, isSkip(text) ? "✅ تم إلغاء اشتراط الاشتراك الإجباري." : `✅ تم تعيين قناة الاشتراك الإجباري: @${text.replace(/^@/, "")}`);
      return;
    }
    if (adminPending?.mode === "admin_reply" && text) {
      await setPending(tgUserId, null);
      await bot.api.sendMessage(Number(adminPending.targetUserId), `↩️ رد من الإدارة:\n\n${text}`).catch(() => null);
      await prisma.jobsAdminMessage.update({ where: { id: adminPending.messageId }, data: { status: "READ" } }).catch(() => null);
      await bot.api.sendMessage(chatId, "✅ تم إرسال ردك.");
      return;
    }
    if (text === "📊 الإحصائيات") return sendAdminStats(bot, chatId);
    if (text === "📥 رسائل واردة") return sendAdminInboxSummary(bot, chatId);
    if (text === "💰 المحفظة") {
      const [totalBalance, totalEscrowed] = await Promise.all([
        prisma.jobsUser.aggregate({ where: { id: { not: SUPER_ADMIN_ID || "__none__" } }, _sum: { balance: true } }),
        prisma.storeOrder.aggregate({ where: { status: "ESCROWED" }, _sum: { amount: true } }),
      ]);
      await bot.api.sendMessage(chatId, `💰 محفظة البوت\n\nإجمالي أرصدة المستخدمين: $${(totalBalance._sum.balance || 0).toFixed(2)}\nمبالغ محجوزة حالياً (Escrow): $${(totalEscrowed._sum.amount || 0).toFixed(2)}`);
      return;
    }
    if (text === "🔎 بحث عن مستخدم") {
      await setPending(tgUserId, { mode: "admin_lookup" });
      await bot.api.sendMessage(chatId, "أرسل آيدي المستخدم:");
      return;
    }
    if (text === "📡 قناة الاشتراك الإجباري") {
      await setPending(tgUserId, { mode: "admin_channel" });
      await bot.api.sendMessage(chatId, "أرسل معرّف القناة (@channel)، أو اضغط تخطّي لإلغاء الاشتراط الحالي:", { reply_markup: skipMenu() });
      return;
    }
    if (text === "🔓 رفع حظر/كتم") {
      await setPending(tgUserId, { mode: "admin_unban" });
      await bot.api.sendMessage(chatId, "أرسل آيدي المستخدم:");
      return;
    }
    if (text === "📢 بث جماعي") {
      await setPending(tgUserId, { mode: "admin_broadcast" });
      await bot.api.sendMessage(chatId, "✍️ اكتب رسالة البث الجماعي — ستُرسل لجميع مستخدمي البوت:");
      return;
    }
    return;
  }

  const user = await ensureJobsUser(botRow.id, tgUserId);
  await prisma.jobsUser.update({ where: { id: tgUserId }, data: { lastActiveAt: new Date() } }).catch(() => null);

  if (user.isBanned) {
    await bot.api.sendMessage(chatId, "🚫 تم حظرك من استخدام هذا البوت من قِبل الإدارة.");
    return;
  }
  if (user.mutedUntil && user.mutedUntil > new Date()) {
    await bot.api.sendMessage(chatId, "🔇 أنت مكتوم مؤقتاً. حاول لاحقاً.");
    return;
  }

  // Mandatory subscription channel gate (owner spec, 2026-09-05) — same
  // pattern as AD_BOT's requiredChannel.
  if (botRow.requiredChannel) {
    try {
      const member = await bot.api.getChatMember(`@${botRow.requiredChannel}`, Number(tgUserId));
      if (!["creator", "administrator", "member"].includes(member.status)) {
        await bot.api.sendMessage(chatId, `📡 يجب الاشتراك في القناة أولاً: @${botRow.requiredChannel}`);
        return;
      }
    } catch {
      // channel/bot admin misconfigured — fail open rather than lock everyone out
    }
  }

  if (msg.contact) {
    if (String(msg.contact.user_id) === tgUserId) {
      await prisma.jobsUser.update({ where: { id: tgUserId }, data: { phoneNumber: msg.contact.phone_number, phoneVerified: true } });
      await bot.api.sendMessage(chatId, "✅ تم التحقق من رقم هاتفك.", { reply_markup: mainMenu() });
    } else {
      await bot.api.sendMessage(chatId, "⚠️ يجب مشاركة رقم هاتفك أنت.");
    }
    return;
  }
  if (!user.phoneVerified) {
    await bot.api.sendMessage(chatId, "📱 التحقق من رقم الهاتف خطوة إلزامية قبل استخدام هذا البوت.", {
      reply_markup: new Keyboard().requestContact("📱 مشاركة رقم الهاتف").resized(),
    });
    return;
  }

  const pending = user.pendingAction as PendingAction | null;

  if (msg.photo && pending?.mode === "store_listing_wizard" && pending.step === "photos") {
    if (pending.data.photoFileIds.length < 5) pending.data.photoFileIds.push(msg.photo[msg.photo.length - 1].file_id);
    await setPending(tgUserId, pending);
    await bot.api.sendMessage(chatId, `📷 ${pending.data.photoFileIds.length}/5 — أرسل صورة أخرى أو اضغط «✅ تم».`);
    return;
  }
  if (msg.photo && pending?.mode === "report_evidence") {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    await prisma.jobsReport.create({ data: { reporterId: tgUserId, targetId: pending.targetId, targetKind: pending.targetKind, reason: pending.reason, evidencePhotoFileId: fileId } });
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "🚩 تم إرسال بلاغك.", { reply_markup: mainMenu() });
    return;
  }
  if (msg.photo && pending?.mode === "dispute_evidence") {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    await submitDisputeEvidence(bot, chatId, tgUserId, pending.orderId, pending.side, pending.statement, fileId);
    return;
  }

  const text = String(msg.text || "").trim();
  if (!text) return;

  if (isBack(text)) {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "🏠 القائمة الرئيسية:", { reply_markup: mainMenu() });
    return;
  }
  if (text === "/start" || text.startsWith("/start ")) {
    // AD_BOT hands out "/start adv_<AdClickId>" deep links when a campaign
    // promotes this very bot — consuming it here marks that click verified
    // instantly, with zero cooperation needed beyond this one line (see
    // src/lib/adVerifyPayload.ts for why: every platform bot shares the
    // same database).
    const payload = text.slice(6).trim();
    if (isAdVerifyPayload(payload)) {
      await consumeAdVerifyPayload(payload);
    }
    await setPending(tgUserId, null);
    const profile = await prisma.jobsProfile.findUnique({ where: { userId: tgUserId } });
    if (!profile) {
      await startProfileWizard(bot, chatId, tgUserId);
    } else {
      await bot.api.sendMessage(chatId, `أهلاً بك مجدداً، ${profile.name} 👋`, { reply_markup: mainMenu() });
    }
    return;
  }

  // ---- Pending wizards ----
  if (pending?.mode === "profile_wizard") return consumeProfileStep(bot, chatId, tgUserId, pending, text);
  if (pending?.mode === "job_posting_wizard") return consumeJobPostingStep(bot, chatId, tgUserId, pending, text);
  if (pending?.mode === "job_posting_description_review") {
    await bot.api.sendMessage(chatId, "اختر إحدى النسختين بالضغط على أحد الزرين أعلاه.");
    return;
  }
  if (pending?.mode === "store_listing_wizard") return consumeStoreListingStep(bot, chatId, tgUserId, pending, text);
  if (pending?.mode === "store_wanted_wizard") return consumeStoreWantedStep(bot, chatId, tgUserId, pending, text);
  if (pending?.mode === "job_search_keyword") {
    const keyword = isSkip(text) && pending.fallbackKeyword ? pending.fallbackKeyword : text;
    await setPending(tgUserId, null);
    return sendJobPostingResults(bot, chatId, keyword, 0, tgUserId);
  }
  if (pending?.mode === "store_search_keyword") {
    await setPending(tgUserId, null);
    return sendStoreResults(bot, chatId, text, 0, tgUserId);
  }
  if (pending?.mode === "wanted_search_keyword") {
    await setPending(tgUserId, null);
    return sendWantedResults(bot, chatId, text, 0, tgUserId);
  }
  if (pending?.mode === "offer_price") {
    const price = Number(text.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(price) || price <= 0) {
      await bot.api.sendMessage(chatId, "أرسل سعراً صحيحاً.");
      return;
    }
    await setPending(tgUserId, null);
    return submitOfferPrice(bot, chatId, tgUserId, pending.kind, pending.targetId, price);
  }
  if (pending?.mode === "offer_counter") {
    const price = Number(text.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(price) || price <= 0) {
      await bot.api.sendMessage(chatId, "أرسل سعراً صحيحاً.");
      return;
    }
    await setPending(tgUserId, null);
    return submitOfferCounter(bot, chatId, tgUserId, pending.offerId, price);
  }
  if (pending?.mode === "professional_search_category") {
    if (text === OTHER_CATEGORY_LABEL) {
      await setPending(tgUserId, { mode: "professional_search_category_custom" });
      await bot.api.sendMessage(chatId, "اكتب اسم المهنة التي تبحث عنها:", { reply_markup: plainBackMenu() });
      return;
    }
    if (!PROFESSIONAL_CATEGORIES.includes(text)) {
      await bot.api.sendMessage(chatId, "اختر من القائمة.", { reply_markup: professionalCategoryMenu() });
      return;
    }
    await setPending(tgUserId, { mode: "professional_search_region", category: text });
    await bot.api.sendMessage(chatId, "في أي منطقة (محافظة أو مدينة)؟ أو اضغط تخطّي للبحث في كل المناطق:", { reply_markup: skipMenu() });
    return;
  }
  if (pending?.mode === "professional_search_category_custom") {
    if (!text) return;
    await setPending(tgUserId, { mode: "professional_search_region", category: text });
    await bot.api.sendMessage(chatId, "في أي منطقة (محافظة أو مدينة)؟ أو اضغط تخطّي للبحث في كل المناطق:", { reply_markup: skipMenu() });
    return;
  }
  if (pending?.mode === "professional_search_region") {
    await setPending(tgUserId, null);
    return sendProfessionalResults(bot, chatId, pending.category, isSkip(text) ? "" : text, 0, tgUserId);
  }
  if (pending?.mode === "report_reason") {
    await setPending(tgUserId, { mode: "report_evidence", targetId: pending.targetId, targetKind: pending.targetKind, reason: text });
    await bot.api.sendMessage(chatId, "أرسل صورة كدليل إن وُجدت، أو اضغط «تخطّي»:", { reply_markup: skipMenu() });
    return;
  }
  if (pending?.mode === "report_evidence") {
    if (isSkip(text)) {
      await prisma.jobsReport.create({ data: { reporterId: tgUserId, targetId: pending.targetId, targetKind: pending.targetKind, reason: pending.reason } });
      await setPending(tgUserId, null);
      await bot.api.sendMessage(chatId, "🚩 تم إرسال بلاغك.", { reply_markup: mainMenu() });
      return;
    }
    await bot.api.sendMessage(chatId, "أرسل صورة، أو اضغط «تخطّي».");
    return;
  }
  if (pending?.mode === "dispute_statement") {
    if (!text) return;
    return submitDisputeStatement(bot, chatId, tgUserId, pending.orderId, pending.side, text);
  }
  if (pending?.mode === "dispute_evidence") {
    if (isSkip(text)) return submitDisputeEvidence(bot, chatId, tgUserId, pending.orderId, pending.side, pending.statement, null);
    await bot.api.sendMessage(chatId, "أرسل صورة، أو اضغط «تخطّي».");
    return;
  }
  if (pending?.mode === "contact_admin_compose") {
    const saved = await prisma.jobsAdminMessage.create({ data: { senderId: tgUserId, text } });
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "✅ تم إرسال رسالتك للإدارة.", { reply_markup: mainMenu() });
    if (SUPER_ADMIN_ID) {
      await bot.api
        .sendMessage(Number(SUPER_ADMIN_ID), `📩 رسالة جديدة من #${shortId(tgUserId)}:\n\n${text}`, {
          reply_markup: new InlineKeyboard().text("↩️ رد", `jadmin_reply|${tgUserId}|${saved.id}`),
        })
        .catch(() => null);
    }
    return;
  }
  if (pending?.mode === "ask_nova") {
    if (!text) return;
    await bot.api.sendChatAction(chatId, "typing").catch(() => null);
    const result = await askNovaAssist(tgUserId, text);
    await bot.api.sendMessage(chatId, result.ok ? result.text! : (result.error || "تعذّر الحصول على رد الآن."), {
      reply_markup: plainBackMenu(),
    });
    return;
  }
  if (pending?.mode === "suggestion_compose" || pending?.mode === "suggestion_confirm") {
    if (!text) return;
    await setPending(tgUserId, { mode: "suggestion_confirm", text });
    await bot.api.sendMessage(chatId, `💡 اقتراحك:\n\n${text}\n\nإن أردت تعديله أرسل نصاً جديداً، أو اضغط تأكيد للإرسال.`, {
      reply_markup: new InlineKeyboard().text("✅ تأكيد", "jsuggestion_confirm"),
    });
    return;
  }

  // ---- Main navigation ----
  const profile = await prisma.jobsProfile.findUnique({ where: { userId: tgUserId } });
  if (!profile && text !== "ℹ️ معلومات") {
    await startProfileWizard(bot, chatId, tgUserId);
    return;
  }

  if (text === "👤 ملفي الشخصي") {
    const kb = new InlineKeyboard().text("✏️ تعديل الملف الشخصي", "jeditprofile");
    if (profile!.roleType === "PROFESSIONAL") {
      kb.row().text(profile!.isPaused ? "▶️ تفعيل الظهور في نتائج البحث" : "⏸ إيقاف الظهور في نتائج البحث", "jtoggleprofilepause");
    }
    await bot.api.sendMessage(
      chatId,
      `${roleLabel(profile!.roleType)}\n\n👤 ${profile!.name}، ${profile!.age}\n🌍 ${profile!.country}، ${profile!.governorate}، ${profile!.city}\n` +
        (profile!.seekerProfession ? `💼 يبحث عن: ${profile!.seekerProfession}\n` : "") +
        (profile!.employerBusinessName ? `🏢 ${profile!.employerBusinessName}\n` : "") +
        (profile!.professionalCategory ? `🔨 ${profile!.professionalCategory}\n` : "") +
        (profile!.roleType === "PROFESSIONAL" ? `📌 الظهور في البحث: ${profile!.isPaused ? "⏸ متوقف" : "🟢 مفعّل"}\n` : ""),
      { reply_markup: kb }
    );
    return;
  }
  if (text === "💰 رصيدي وإيداع") {
    await bot.api.sendMessage(chatId, `💰 رصيدك الحالي: $${user.balance.toFixed(2)}\n\nللإيداع، افتح الرابط:\n${depositLink(tgUserId)}`, { reply_markup: mainMenu() });
    return;
  }
  if (text === "🔷 إيداع TON / USDT مباشر" && isNativeTonConfigured()) {
    const address = getMasterHotWalletAddress()!;
    const memo = await getOrCreateJobsTonMemo(tgUserId);
    await bot.api.sendMessage(
      chatId,
      `🔷 إيداع TON أو USDT مباشر (أسرع وأقل رسوماً من الدفع بالطريقة الأخرى)\n\nأرسل TON أو USDT (فقط على شبكة TON) إلى العنوان التالي، مع كتابة المذكرة (Memo/Comment) بالضبط كما هي — بدونها لن يُحتسب إيداعك:\n\nالعنوان:\n${address}\n\nالمذكرة:\n${memo}\n\n⚠️ لا ترسل USDT من شبكة أخرى (TRC20/ERC20 وغيرها) لهذا العنوان.\n\nيُضاف الرصيد تلقائياً خلال دقائق من تأكيد الشبكة.`,
      { reply_markup: mainMenu() }
    );
    return;
  }
  if (text === "ℹ️ معلومات") {
    await bot.api.sendMessage(
      chatId,
      "ℹ️ بوت فرص العمل والمتجر\n\nابحث عن وظيفة أو مهني، أنشر وظيفة شاغرة، أو بع/اشترِ في المتجر بأمان عبر نظام الحجز الآمن.\n💡 لاقتراح خاصية جديدة أو تعديل محدد، اضغط «اقتراح».\n🔗 لدعوة آخرين، اضغط «مشاركة الرابط».",
      { reply_markup: infoMenu() }
    );
    return;
  }
  if (text === "🔗 مشاركة الرابط") {
    const me = await bot.api.getMe();
    await bot.api.sendMessage(chatId, `🔗 شارك هذا الرابط مع من يبحث عن عمل أو منتجات:\n\nhttps://t.me/${me.username}`, { reply_markup: infoMenu() });
    return;
  }
  if (text === "💡 اقتراح") {
    await setPending(tgUserId, { mode: "suggestion_compose" });
    await bot.api.sendMessage(
      chatId,
      "💡 هذا الزر يُستخدم فقط إن كان لديك اقتراح للإدارة لإضافة خاصية جديدة أو تعديل شيء محدد في البوت.\n\nاكتب رسالتك واضغط تأكيد.",
      { reply_markup: plainBackMenu() }
    );
    return;
  }
  if (text === "📩 مراسلة الأدمن") {
    await setPending(tgUserId, { mode: "contact_admin_compose" });
    await bot.api.sendMessage(chatId, "✍️ اكتب رسالتك للإدارة:", { reply_markup: plainBackMenu() });
    return;
  }
  if (text === "✨ اسأل نوفا (ذكاء اصطناعي)") {
    await setPending(tgUserId, { mode: "ask_nova" });
    await bot.api.sendMessage(
      chatId,
      "✨ اكتب سؤالك وسيجيبك نوفا (نفس مساعد الذكاء الاصطناعي في بوت Nova AI) — يشاركك نفس رصيدك المجاني اليومي هناك.",
      { reply_markup: plainBackMenu() }
    );
    return;
  }

  if (text === "💼 قسم العمل") {
    await bot.api.sendMessage(chatId, "💼 قسم العمل:", { reply_markup: workMenu() });
    return;
  }
  if (text === "📢 نشر") {
    if (profile!.roleType === "EMPLOYER") return startJobPostingWizard(bot, chatId, tgUserId);
    if (profile!.roleType === "PROFESSIONAL") {
      await bot.api.sendMessage(chatId, "ملفك كمهني هو إعلانك — يمكنك تعديله من «👤 ملفي الشخصي». لتحديث الوصف أعد إنشاء الملف.", { reply_markup: workMenu() });
      return;
    }
    await bot.api.sendMessage(chatId, "⚠️ النشر متاح فقط لملفات «معلن وظيفة» و«مهني».", { reply_markup: workMenu() });
    return;
  }
  if (text === "🔍 بحث") {
    await bot.api.sendMessage(chatId, "ماذا تريد أن تبحث عنه؟", { reply_markup: workSearchMenu() });
    return;
  }
  if (text === "🔍 عن مهني") {
    await setPending(tgUserId, { mode: "professional_search_category" });
    await bot.api.sendMessage(chatId, "اختر الحرفة المطلوبة:", { reply_markup: professionalCategoryMenu() });
    return;
  }
  if (text === "🔍 عن وظيفة شاغرة") {
    if (profile!.roleType === "SEEKER" && profile!.seekerProfession) {
      await setPending(tgUserId, { mode: "job_search_keyword", fallbackKeyword: profile!.seekerProfession });
      await bot.api.sendMessage(chatId, "اكتب كلمة بحث، أو اضغط «⏭ تخطّي» للبحث التلقائي بمهنتك المسجّلة:", { reply_markup: skipMenu() });
      return;
    }
    await setPending(tgUserId, { mode: "job_search_keyword" });
    await bot.api.sendMessage(chatId, "اكتب مسمى الوظيفة أو كلمة مفتاحية:", { reply_markup: plainBackMenu() });
    return;
  }

  if (text === "🛒 قسم المتجر") {
    await bot.api.sendMessage(chatId, "🛒 قسم المتجر:", { reply_markup: storeMenu() });
    return;
  }
  if (text === "🔍 تصفح المنتجات") {
    await bot.api.sendMessage(chatId, "🔍 تصفح المنتجات:", { reply_markup: storeBrowseMenu() });
    return;
  }
  if (text === "🛒 تصفح للبيع") {
    return sendStoreResults(bot, chatId, "", 0, tgUserId);
  }
  if (text === "🛍 تصفح للشراء") {
    return sendWantedResults(bot, chatId, "", 0, tgUserId);
  }
  if (text === "🔍 بحث عن منتج") {
    await bot.api.sendMessage(chatId, "🔍 ابحث في:", { reply_markup: storeSearchMenu() });
    return;
  }
  if (text === "🛍 لتشتري") {
    await setPending(tgUserId, { mode: "store_search_keyword" });
    await bot.api.sendMessage(chatId, "اكتب اسم المنتج أو كلمة مفتاحية:", { reply_markup: plainBackMenu() });
    return;
  }
  if (text === "💰 لتبيع") {
    await setPending(tgUserId, { mode: "wanted_search_keyword" });
    await bot.api.sendMessage(chatId, "اكتب كلمة مفتاحية تصف ما يبحث عنه المشترون:", { reply_markup: plainBackMenu() });
    return;
  }
  if (text === "📂 طلباتي") {
    await bot.api.sendMessage(chatId, "📂 طلباتي:", { reply_markup: myOrdersMenu() });
    return;
  }
  if (text === "🛍 طلباتي (شراء)") {
    return sendMyWantedListings(bot, chatId, tgUserId, 0);
  }
  if (text === "💰 طلباتي (بيع)") {
    return sendMyStoreListings(bot, chatId, tgUserId, 0);
  }
  if (text === "💰 أمر بيع") {
    if (profile!.roleType !== "TRADER") {
      await bot.api.sendMessage(chatId, "⚠️ البيع متاح فقط لملفات «تاجر».", { reply_markup: storeMenu() });
      return;
    }
    return startStoreListingWizard(bot, chatId, tgUserId);
  }
  if (text === "🛍 أمر شراء") {
    if (profile!.roleType !== "TRADER") {
      await bot.api.sendMessage(chatId, "⚠️ نشر طلب شراء متاح فقط لملفات «تاجر». يمكنك تصفح المتجر بحرية رغم ذلك.", { reply_markup: storeMenu() });
      return;
    }
    return startStoreWantedWizard(bot, chatId, tgUserId);
  }

  await bot.api.sendMessage(chatId, "اختر من القائمة.", { reply_markup: mainMenu() });
}

async function handleJobsCallback(bot: TelegramBot, botRow: BotRow, cq: any) {
  const chatId = cq.message?.chat?.id;
  const tgUserId = String(cq.from.id);
  const data = String(cq.data || "");
  if (!chatId) return;

  if (data.startsWith("jadmin_") || data.startsWith("jrep_") || data.startsWith("jresolve|")) {
    if (!SUPER_ADMIN_ID || tgUserId !== SUPER_ADMIN_ID) {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    if (data.startsWith("jadmin_reply|")) {
      const [, targetUserId, messageId] = data.split("|");
      await ensureJobsUser(botRow.id, tgUserId);
      await setPending(tgUserId, { mode: "admin_reply", targetUserId, messageId });
      await bot.api.sendMessage(chatId, "اكتب ردك:");
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    if (data.startsWith("jadmin_read|")) {
      const messageId = data.split("|")[1];
      await prisma.jobsAdminMessage.update({ where: { id: messageId }, data: { status: "READ" } }).catch(() => null);
      await bot.api.answerCallbackQuery(cq.id, { text: "✅ تم" }).catch(() => null);
      return;
    }
    if (data.startsWith("jrep_ignore|")) {
      const reportId = data.split("|")[1];
      await prisma.jobsReport.update({ where: { id: reportId }, data: { status: "REVIEWED" } }).catch(() => null);
      await bot.api.answerCallbackQuery(cq.id, { text: "تم التجاهل" }).catch(() => null);
      return;
    }
    if (data.startsWith("jrep_ban|")) {
      const [, reportId, targetId] = data.split("|");
      await prisma.jobsUser.update({ where: { id: targetId }, data: { isBanned: true } }).catch(() => null);
      await prisma.jobsReport.update({ where: { id: reportId }, data: { status: "REVIEWED" } }).catch(() => null);
      await bot.api.answerCallbackQuery(cq.id, { text: "⛔ تم الحظر" }).catch(() => null);
      return;
    }
    if (data.startsWith("jrep_mute|")) {
      const [, reportId, targetId] = data.split("|");
      const mutedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.jobsUser.update({ where: { id: targetId }, data: { mutedUntil } }).catch(() => null);
      await prisma.jobsReport.update({ where: { id: reportId }, data: { status: "REVIEWED" } }).catch(() => null);
      await bot.api.sendMessage(Number(targetId), "🔇 تم كتمك مؤقتاً لمدة 24 ساعة بسبب مخالفة بلّغ عنها أحد المستخدمين.").catch(() => null);
      await bot.api.answerCallbackQuery(cq.id, { text: "🔇 تم الكتم 24 ساعة" }).catch(() => null);
      return;
    }
    if (data.startsWith("jadmin_toggleban|")) {
      const targetId = data.split("|")[1];
      const target = await prisma.jobsUser.findUnique({ where: { id: targetId } });
      if (!target) {
        await bot.api.answerCallbackQuery(cq.id, { text: "غير موجود" }).catch(() => null);
        return;
      }
      const nowBanned = !target.isBanned;
      await prisma.jobsUser.update({ where: { id: targetId }, data: { isBanned: nowBanned, mutedUntil: nowBanned ? target.mutedUntil : null } });
      await bot.api
        .sendMessage(Number(targetId), nowBanned ? "🚫 تم حظرك من استخدام هذا البوت من قِبل الإدارة." : "✅ تم رفع الحظر عنك من قِبل الإدارة، يمكنك استخدام البوت الآن.")
        .catch(() => null);
      await bot.api.answerCallbackQuery(cq.id, { text: nowBanned ? "⛔ تم الحظر" : "🔓 تم رفع الحظر" }).catch(() => null);
      return;
    }
    if (data.startsWith("jresolve|")) {
      const [, orderId, winner] = data.split("|");
      await resolveDispute(bot, chatId, orderId, winner as "buyer" | "seller");
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    return;
  }

  await ensureJobsUser(botRow.id, tgUserId);

  if (data === "jeditprofile") {
    await startProfileWizard(bot, chatId, tgUserId);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data === "jtoggleprofilepause") {
    const profile = await prisma.jobsProfile.findUnique({ where: { userId: tgUserId } });
    if (!profile || profile.roleType !== "PROFESSIONAL") {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    const isPaused = !profile.isPaused;
    await prisma.jobsProfile.update({ where: { userId: tgUserId }, data: { isPaused } });
    await bot.api
      .sendMessage(chatId, isPaused ? "⏸ تم إيقاف ظهورك في نتائج البحث عن مهنيين." : "▶️ تم تفعيل ظهورك في نتائج البحث مجدداً.", { reply_markup: mainMenu() })
      .catch(() => null);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("jai_use|")) {
    const choice = data.split("|")[1];
    const pending = (await prisma.jobsUser.findUnique({ where: { id: tgUserId } }))?.pendingAction as PendingAction | null;
    if (pending?.mode !== "job_posting_description_review") {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    const draft = pending.data;
    if (choice === "ai") draft.description = pending.suggested;
    await advanceJobPostingStep(bot, chatId, tgUserId, "description", draft);
    await bot.api.answerCallbackQuery(cq.id, { text: choice === "ai" ? "✅ استُخدمت نسخة نوفا" : "✅ استُخدم النص الأصلي" }).catch(() => null);
    return;
  }
  if (data === "jsuggestion_confirm") {
    const pending = (await prisma.jobsUser.findUnique({ where: { id: tgUserId } }))?.pendingAction as PendingAction | null;
    if (pending?.mode !== "suggestion_confirm") {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    const saved = await prisma.jobsAdminMessage.create({ data: { senderId: tgUserId, text: `💡 اقتراح:\n${pending.text}` } });
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "✅ تم إرسال اقتراحك للإدارة، شكراً لك!", { reply_markup: mainMenu() });
    if (SUPER_ADMIN_ID) {
      await bot.api
        .sendMessage(Number(SUPER_ADMIN_ID), `💡 اقتراح جديد من #${shortId(tgUserId)}:\n\n${pending.text}`, {
          reply_markup: new InlineKeyboard().text("↩️ رد", `jadmin_reply|${tgUserId}|${saved.id}`),
        })
        .catch(() => null);
    }
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("jview|")) {
    const [, kind, id] = data.split("|");
    if (kind === "posting") await sendJobPostingCard(bot, chatId, id, tgUserId);
    else if (kind === "profile") await sendProfessionalCard(bot, chatId, id, tgUserId);
    else if (kind === "listing") await sendStoreListingCard(bot, chatId, id, tgUserId);
    else if (kind === "wanted") await sendStoreWantedCard(bot, chatId, id, tgUserId);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("jmore|")) {
    const parts = data.split("|");
    if (parts[1] === "posting") await sendJobPostingResults(bot, chatId, decodeURIComponent(parts[2]), Number(parts[3]), tgUserId);
    else if (parts[1] === "professional") await sendProfessionalResults(bot, chatId, decodeURIComponent(parts[2]), decodeURIComponent(parts[3]), Number(parts[4]), tgUserId);
    else if (parts[1] === "listing") await sendStoreResults(bot, chatId, decodeURIComponent(parts[2]), Number(parts[3]), tgUserId);
    else if (parts[1] === "wanted") await sendWantedResults(bot, chatId, decodeURIComponent(parts[2]), Number(parts[3]), tgUserId);
    else if (parts[1] === "mywanted") await sendMyWantedListings(bot, chatId, tgUserId, Number(parts[3]));
    else if (parts[1] === "mylistings") await sendMyStoreListings(bot, chatId, tgUserId, Number(parts[3]));
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("jbuy|")) {
    const listingId = data.split("|")[1];
    await startOffer(bot, chatId, tgUserId, "LISTING", listingId);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("jselloffer|")) {
    const wantedId = data.split("|")[1];
    await startOffer(bot, chatId, tgUserId, "WANTED", wantedId);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("jeditlisting|")) {
    const listingId = data.split("|")[1];
    const l = await prisma.storeListing.findUnique({ where: { id: listingId } });
    if (!l || l.sellerId !== tgUserId) {
      await bot.api.answerCallbackQuery(cq.id, { text: "غير مسموح" }).catch(() => null);
      return;
    }
    await startStoreListingWizard(bot, chatId, tgUserId, listingId);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("jtogglelisting|")) {
    await toggleListingStatus(bot, chatId, tgUserId, data.split("|")[1]);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("jdeletelisting|")) {
    await deleteListing(bot, chatId, tgUserId, data.split("|")[1]);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("jeditwanted|")) {
    const wantedId = data.split("|")[1];
    const w = await prisma.storeWantedListing.findUnique({ where: { id: wantedId } });
    if (!w || w.buyerId !== tgUserId) {
      await bot.api.answerCallbackQuery(cq.id, { text: "غير مسموح" }).catch(() => null);
      return;
    }
    await startStoreWantedWizard(bot, chatId, tgUserId, wantedId);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("jtogglewanted|")) {
    await toggleWantedStatus(bot, chatId, tgUserId, data.split("|")[1]);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("jdeletewanted|")) {
    await deleteWanted(bot, chatId, tgUserId, data.split("|")[1]);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("joffer_accept|")) {
    const offerId = data.split("|")[1];
    await respondOffer(bot, chatId, tgUserId, offerId, "accept");
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("joffer_reject|")) {
    const offerId = data.split("|")[1];
    await respondOffer(bot, chatId, tgUserId, offerId, "reject");
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("joffer_negotiate|")) {
    const offerId = data.split("|")[1];
    await startNegotiate(bot, chatId, tgUserId, offerId);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("jreceived|")) {
    const orderId = data.split("|")[1];
    await confirmReceived(bot, chatId, tgUserId, orderId);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("jdispute|")) {
    const orderId = data.split("|")[1];
    await openDispute(bot, chatId, tgUserId, orderId);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("jdisputestate|")) {
    const orderId = data.split("|")[1];
    const order = await prisma.storeOrder.findUnique({ where: { id: orderId } });
    if (order && (order.buyerId === tgUserId || order.sellerId === tgUserId)) {
      const side = order.buyerId === tgUserId ? "buyer" : "seller";
      await setPending(tgUserId, { mode: "dispute_statement", orderId, side });
      await bot.api.sendMessage(chatId, "اكتب إفادتك بخصوص هذا الطلب:", { reply_markup: plainBackMenu() });
    }
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("jreport|")) {
    const [, targetKind, targetId] = data.split("|");
    await setPending(tgUserId, { mode: "report_reason", targetId, targetKind: targetKind as any });
    await bot.api.sendMessage(chatId, "🚩 اكتب سبب البلاغ:", { reply_markup: plainBackMenu() });
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("jblock|")) {
    const targetId = data.split("|")[1];
    await prisma.jobsBlock.upsert({ where: { blockerId_blockedId: { blockerId: tgUserId, blockedId: targetId } }, update: {}, create: { blockerId: tgUserId, blockedId: targetId } }).catch(() => null);
    await bot.api.answerCallbackQuery(cq.id, { text: "⛔ تم الحظر" }).catch(() => null);
    return;
  }
  await bot.api.answerCallbackQuery(cq.id).catch(() => null);
}
