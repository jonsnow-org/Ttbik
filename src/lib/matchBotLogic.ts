import { Bot as TelegramBot, Keyboard, InlineKeyboard } from "grammy";
import { prisma } from "@/lib/prisma";
import { SITE_URL } from "@/lib/siteUrl";
import { supabaseAdmin } from "@/lib/supabase";
import type { Bot as BotRow, MatchProfile, MatchUser, PartnerPreference } from "@prisma/client";
import { getMasterHotWalletAddress, isNativeTonConfigured } from "@/services/ton-service";
import { getOrCreateMatchTonMemo } from "@/services/marriageTonService";
import { askNovaAssist, improveListingText, novaAssistConfigured } from "@/lib/novaAssist";
import { isAdVerifyPayload, consumeAdVerifyPayload } from "@/lib/adVerifyPayload";
import { recordBotVisit, countBotVisitors } from "@/lib/botVisit";
import { startGuide } from "@/lib/botStartGuide";
import { formatBroadcastText, BROADCAST_COMPOSE_HINT } from "@/lib/utils";
import { handleMatchInlineQuery, handleHybridCallback, openProfileDeepLink, ensureMiniAppMenu, miniAppUrl } from "@/lib/match/hybrid";
import { parseProfileStart } from "@/lib/match/inline";
import { clearAnonHistory, recordAnonMessage, getAnonFilterRow, getAnonFilterRows, setAnonActiveQueue, setAnonFilterValue, markAnonNotified } from "@/lib/match/appStore";
import { anonPairOk, activeFilterFor, describeAnonFilter } from "@/lib/match/anonRules";
import { sanitizeAnonFilter, anonFilterIsEmpty, type AnonFilter } from "@/lib/match/premium";
import { randomUUID } from "crypto";
import { after } from "next/server";
import { CONTACT_BLOCKED_TEXT, containsContactInfo } from "@/lib/match/contactGuard";
import { pgRateLimit } from "@/lib/match/rateLimitPg";
import { auditAdmin, ensureMatchAppTables, idleRandomSessions } from "@/lib/match/appStore";
import { pushNotification } from "@/lib/match/social";
import { pingAnonSession } from "@/lib/match/realtime";
import { deliverToUser } from "@/lib/match/surface";
import {
  PRICE_BOOST_24H, PRICE_VERIFIED_BADGE, PRICE_EXTRA_PHOTOS, PRICE_PROFILE_VISITORS, PRICE_ADVANCED_FILTERS, PRICE_SUPER_LIKE, PRICE_VIP_30D,
  isVipActive, hasAdvancedFilters, hasProfileVisitors, isEffectivelyBoosted, depositLink, insufficientBalanceText, chargeMatchUser,
  purchaseBoost, purchaseVip, purchaseAnonFilters, hasAnonFilters, PRICE_ANON_FILTERS, ANON_FILTERS_DAYS, unlockProfileVisitors, unlockAdvancedFilters, unlockExtraPhotos, toggleIncognito, chargeSuperLike,
  purchaseByKey, purchaseRewind, recordPass, isBuyNowKey, PRICE_REWIND, firstPurchaseEligible, discountedPrice, FIRST_PURCHASE_DISCOUNT,
} from "@/lib/match/entitlements";
import { trackFunnel } from "@/lib/match/growth";
import { atharEnabled, recordMoment } from "@/lib/match/athar";
import { sendStarsInvoice, starsDepositKeyboard, starsPayload, parseStarsPayload, usdForStars, creditStarsPayment, depositChoicesText } from "@/lib/starsPayment";

/**
 * MARRIAGE_BOT template (owner spec, 2026-09-02) — a fully independent
 * matchmaking/marriage bot, deliberately separate from AD_BOT's data model
 * and business logic (see prisma/schema.prisma's MatchUser/MatchProfile/...
 * block for the full reasoning). Arabic-only — no bilingual requirement was
 * given for this bot, unlike AD_BOT.
 *
 * Two UI conventions, both deliberate:
 * - Reply keyboards (Keyboard) for the main menu and every step wizard —
 *   consistent with the rest of the platform.
 * - InlineKeyboard ONLY on the search-result card and during an active
 *   random chat's control row — same precedent as AD_BOT's ad carousel:
 *   per-card actions (like/report/block/next) are naturally suited to
 *   buttons attached to one specific message, not the persistent bottom
 *   keyboard.
 */

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_TELEGRAM_ID || "";
/** The bot's EXACT admin check (single SUPER_ADMIN, global env) — reused by the Mini App dashboard. */
export function isMatchAdmin(tgUserId: string | null | undefined): boolean {
  return !!SUPER_ADMIN_ID && String(tgUserId || "") === SUPER_ADMIN_ID;
}
const RANDOM_CHAT_WINDOW_SECONDS = 60;
const SKIP_COOLDOWN_HOURS = 24;
const ONLINE_THRESHOLD_MINUTES = 5;
const CONTACT_REQUEST_THRESHOLD = 15; // messages exchanged before offering the formal-contact-request button

// Paid feature pricing (owner spec, 2026-09-05) — USD-equivalent, charged
// from MatchUser.balance (see the MARRIAGE_BOT ledger). All one-time
// purchases are permanent unlocks except Boost (24h) and VIP (30 days).
// Prices/durations now live in src/lib/match/entitlements.ts (shared with the Mini App).

// Duplicated (not imported) from adBotLogic.ts's own BANNED_WORDS list on
// purpose — MARRIAGE_BOT's logic never imports from or edits AD_BOT's
// files (owner directive, 2026-09-05), same reasoning as
// marriageTonService.ts not importing from ton-service.ts. A first-pass
// net for the obvious cases in random chat; anything past this reaches
// the existing 🚩 إبلاغ report path instead.
const MATCH_BANNED_WORDS = [
  "مخدرات",
  "قمار",
  "كازينو",
  "اباحي",
  "إباحي",
  "دعارة",
  "احتيال",
  "نصب",
  "porn",
  "xxx",
  "nude",
  "escort",
  "casino",
  "gambling",
  "drugs",
  "cocaine",
  "scam",
  "phishing",
];
export function containsMatchBannedWords(text: string): boolean {
  const lower = text.toLowerCase();
  return MATCH_BANNED_WORDS.some((w) => lower.includes(w.toLowerCase()));
}

function shortId(id: string): string {
  return id.slice(-6);
}

type Gender = "MALE" | "FEMALE";
type ProfileStep =
  | "gender" | "name" | "age" | "country" | "job" | "education" | "attributes"
  | "city" | "maritalStatus" | "contactMethod" | "contactValue" | "photo" | "voice";
type PrefStep = "country" | "ageMin" | "ageMax" | "job" | "education" | "attributes";
type ProfileDraft = {
  gender?: Gender;
  name?: string;
  age?: number;
  country?: string;
  job?: string | null;
  education?: string | null;
  attributes?: string | null;
  city?: string | null;
  maritalStatus?: string | null;
  contactMethod?: "TELEGRAM" | "WHATSAPP";
  contactValue?: string;
  photoFileId?: string | null;
  voiceFileId?: string | null;
};
type PrefDraft = {
  country?: string;
  ageMin?: number | null;
  ageMax?: number | null;
  job?: string | null;
  education?: string | null;
  attributes?: string | null;
};

type PendingAction =
  | { mode: "profile_wizard"; step: ProfileStep; data: ProfileDraft }
  | { mode: "pref_wizard"; step: PrefStep; data: PrefDraft }
  | { mode: "search_browsing"; queue: string[]; index: number; current?: string; msgId?: number; strict?: boolean }
  | { mode: "random_waiting" }
  | { mode: "random_chatting"; sessionId: string; partnerId: string }
  | { mode: "admin_reject_reason"; profileId: string }
  | { mode: "confirm_delete_profile" }
  | { mode: "admin_broadcast" }
  | { mode: "admin_lookup" }
  | { mode: "admin_unban" }
  | { mode: "contact_admin_compose" }
  | { mode: "ask_nova" }
  | { mode: "attributes_ai_review"; data: ProfileDraft; step: ProfileStep; suggested: string }
  | { mode: "admin_reply"; targetUserId: string; messageId: string }
  | { mode: "verify_badge_photo" }
  | { mode: "extra_photo_upload"; slot: 2 | 3 }
  | { mode: "advanced_filter_wizard"; step: "city" | "maritalStatus"; data: { city?: string | null; maritalStatus?: string | null } }
  | { mode: "superlike_note"; targetUserId: string; resume?: { queue: string[]; index: number; current?: string; msgId?: number; strict?: boolean } }
  | { mode: "fake_chatting"; fakeBotId: number; step: number; lastAt: number };

const SKIP_LABEL = "⏭ غير محدد / لا يهم";

function backLabel() {
  return "🔙 القائمة الرئيسية";
}
function mainMenu(): Keyboard {
  return new Keyboard()
    .text("👤 ملفي الشخصي").text("💍 مواصفات الشريك").row()
    .text("🔍 البحث عن شريك").text("🔀 مراسلة عشوائية").row()
    .text("💌 من أعجب بي").text("ℹ️ معلومات").row()
    .text("⭐ الترقيات والمزايا")
    .resized();
}
// Upgrade button labels. With the first-purchase discount (server-checked) the label shows the
// discounted price; handlers accept BOTH variants (isUpgradeLabel), so old keyboards keep working.
const UPGRADE_LABELS = {
  boost: ["🚀 رفع ملفي", PRICE_BOOST_24H, "/24س"],
  verify: ["☑️ طلب التوثيق", PRICE_VERIFIED_BADGE, ""],
  photos: ["🖼 صور إضافية", PRICE_EXTRA_PHOTOS, ""],
  visitors: ["👀 من زار ملفي", PRICE_PROFILE_VISITORS, ""],
  filters: ["🎯 فلاتر متقدمة", PRICE_ADVANCED_FILTERS, ""],
  vip: ["👑 العضوية الذهبية", PRICE_VIP_30D, "/شهر"],
} as const;
export function upgradeLabel(k: keyof typeof UPGRADE_LABELS, discount = false): string {
  const [name, price, unit] = UPGRADE_LABELS[k];
  return discount ? `${name} ($${discountedPrice(price, true)} بدل $${price}${unit})` : `${name} ($${price}${unit})`;
}
export function isUpgradeLabel(text: string, k: keyof typeof UPGRADE_LABELS): boolean {
  return text === upgradeLabel(k, false) || text === upgradeLabel(k, true);
}
function upgradesMenu(discount = false): Keyboard {
  const kb = new Keyboard().text("💰 رصيدي وإيداع").row();
  if (isNativeTonConfigured()) kb.text("🔷 إيداع TON / USDT مباشر").row();
  return kb
    .text(upgradeLabel("boost", discount)).row()
    .text(upgradeLabel("verify", discount)).row()
    .text(upgradeLabel("photos", discount)).row()
    .text(upgradeLabel("visitors", discount)).row()
    .text(upgradeLabel("filters", discount)).row()
    .text(ANON_FILTERS_BUTTON(discount)).row()
    .text("🎯 بحث دقيق (للمشتركين)").row()
    .text(upgradeLabel("vip", discount)).row()
    .text("🕶 وضع التخفي (ضمن الذهبية)").row()
    .text(backLabel())
    .resized();
}
function infoMenu(): Keyboard {
  const kb = new Keyboard().text("📩 مراسلة الأدمن").text("🔗 دعوة رابط البوت").row();
  if (novaAssistConfigured()) kb.text("✨ اسأل نوفا (ذكاء اصطناعي)").row();
  return kb.text(backLabel()).resized();
}
function adminMenu(botId?: string): Keyboard {
  const kb = new Keyboard()
    .text("📊 الإحصائيات").text("📋 الملفات المعلقة").row()
    .text("🚩 بلاغات المطابقة").text("🚩 بلاغات الدردشة العشوائية").row()
    .text("📢 بث جماعي").text("🔎 بحث عن مستخدم").row()
    .text("🔓 رفع حظر/كتم").text("📥 الرسائل الواردة").row()
    .text("🩺 فحص البحث");
  // 📱 opens the Mini App straight on «🛡 لوحة القيادة» (same isMatchAdmin / SUPER_ADMIN_TELEGRAM_ID check server-side).
  if (botId && process.env.MATCH_ADMIN_APP_BUTTON !== "0") kb.row().webApp("📱 التطبيق المصغر", `${miniAppUrl(botId)}?tab=admin`);
  return kb.resized();
}
const ADMIN_COMMANDS = new Set([
  "/start",
  "📊 الإحصائيات",
  "📋 الملفات المعلقة",
  "🚩 بلاغات المطابقة",
  "🚩 بلاغات الدردشة العشوائية",
  "📢 بث جماعي",
  "🔎 بحث عن مستخدم",
  "🔓 رفع حظر/كتم",
  "📥 الرسائل الواردة",
  "🩺 فحص البحث",
]);
const DELETE_CONFIRM_LABEL = "✅ نعم، احذف نهائياً";
function confirmDeleteMenu(): Keyboard {
  return new Keyboard().text(DELETE_CONFIRM_LABEL).row().text(backLabel()).resized();
}
const CONTACT_ADMIN_CONFIRM_LABEL = "✅ متابعة ومراسلة الأدمن";
const CONTACT_ADMIN_WARNING =
  "⚠️ تنبيه هام قبل المتابعة\n\n" +
  "هذه القناة مخصصة حصرياً للمشاكل الجدية المتعلقة بالبوت (مشكلة تقنية فعلية، إساءة خطيرة من مستخدم آخر، أو استفسار إداري حقيقي).\n\n" +
  "🚫 أي استخدام عبثي، رسائل مزعجة، أو تكرار غير مبرر لهذه الميزة سيؤدي إلى حظرك فوراً ونهائياً من هذا البوت دون أي إنذار إضافي.\n\n" +
  "إن كنت متأكداً أن لديك سبباً جدياً فعلاً، اضغط الزر أدناه ثم أرسل رسالتك.";
function contactAdminConfirmMenu(): Keyboard {
  return new Keyboard().text(CONTACT_ADMIN_CONFIRM_LABEL).row().text(backLabel()).resized();
}
// Ready-made answers for profile / partner-preference fields (owner request
// 2026-09-30): the user taps a choice so everyone uses the same wording and
// matching works, but typing a custom answer is still accepted at every step.
const MANUAL_LABEL = "✍️ كتابة يدوية";
const COUNTRY_CHOICES = [
  "السعودية", "مصر", "سوريا", "العراق", "الأردن", "لبنان",
  "فلسطين", "اليمن", "الإمارات", "الكويت", "قطر", "البحرين",
  "عُمان", "المغرب", "الجزائر", "تونس", "ليبيا", "السودان",
];
const JOB_CHOICES = ["موظف/ة", "طالب/ة", "أعمال حرة", "تاجر/ة", "مهندس/ة", "طبيب/ة", "معلّم/ة", "ربّة منزل", "لا أعمل حالياً"];
const EDUCATION_CHOICES = ["ابتدائي / إعدادي", "ثانوي", "معهد / دبلوم", "جامعي", "دراسات عليا"];
const MARITAL_CHOICES = ["أعزب / عزباء", "مطلّق / مطلّقة", "أرمل / أرملة", "متزوّج / متزوّجة"];
const AGE_CHOICES = ["18", "20", "22", "25", "28", "30", "35", "40", "45", "50", "55", "60"];

function choiceMenu(choices: string[], perRow: number, opts: { skip?: boolean; manual?: boolean } = {}): Keyboard {
  const kb = new Keyboard();
  choices.forEach((c, i) => {
    kb.text(c);
    if ((i + 1) % perRow === 0) kb.row();
  });
  if (choices.length % perRow !== 0) kb.row();
  if (opts.manual !== false) kb.text(MANUAL_LABEL);
  if (opts.skip) kb.text(SKIP_LABEL);
  return kb.row().text(backLabel()).resized();
}
function isManual(text: string): boolean {
  return text === MANUAL_LABEL;
}

function skipMenu(): Keyboard {
  return new Keyboard().text(SKIP_LABEL).row().text(backLabel()).resized();
}
export function plainBackMenu(): Keyboard {
  return new Keyboard().text(backLabel()).resized();
}
function genderMenu(): Keyboard {
  return new Keyboard().text("👨 ذكر").text("👩 أنثى").row().text(backLabel()).resized();
}
function contactMethodMenu(): Keyboard {
  return new Keyboard().text("✈️ تلجرام").text("💬 واتساب").row().text(backLabel()).resized();
}
function photoStepMenu(): Keyboard {
  return new Keyboard().text(SKIP_LABEL).row().text(backLabel()).resized();
}
function randomChatMenu(): Keyboard {
  return new Keyboard().text("⏹ إنهاء المحادثة").row().text("🎛 فلاتر الدردشة").resized();
}
const ANON_FILTERS_BUTTON = (discount = false) => discount
  ? `🎛 فلاتر الدردشة العشوائية ($${discountedPrice(PRICE_ANON_FILTERS, true)} بدل $${PRICE_ANON_FILTERS}/${ANON_FILTERS_DAYS} يوم)`
  : `🎛 فلاتر الدردشة العشوائية ($${PRICE_ANON_FILTERS}/${ANON_FILTERS_DAYS} يوم)`;
function isBack(text: string): boolean {
  return text === backLabel() || text === "/cancel";
}
function isSkip(text: string): boolean {
  return text === SKIP_LABEL;
}

async function setPending(userId: string, action: PendingAction | null) {
  await prisma.matchUser.update({ where: { id: userId }, data: { pendingAction: action as any } });
}

// upsert, not findUnique-then-create — see adBotLogic.ts's ensureUser for
// why the check-then-act version is a real race (two near-simultaneous
// updates from the same brand-new user can both pass the existence check
// and the second create() throws, crashing the webhook silently).
async function ensureMatchUser(botId: string, tgUserId: string, referredBy?: string) {
  return prisma.matchUser.upsert({
    where: { id: tgUserId },
    update: {},
    create: { id: tgUserId, botId, referredBy: referredBy && referredBy !== tgUserId ? referredBy : null },
  });
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
function presenceLabel(lastActiveAt: Date): string {
  const minutes = (Date.now() - lastActiveAt.getTime()) / 60000;
  return minutes <= ONLINE_THRESHOLD_MINUTES ? "🟢 متصل الآن" : `⚪ آخر ظهور: ${relativeTime(lastActiveAt)}`;
}

async function isMutuallyBlocked(aId: string, bId: string): Promise<boolean> {
  const block = await prisma.matchBlock.findFirst({
    where: { OR: [{ blockerId: aId, blockedId: bId }, { blockerId: bId, blockedId: aId }] },
  });
  return !!block;
}

// ---------------------------------------------------------------------
// Paid features — shared helpers (owner spec, 2026-09-05)
// ---------------------------------------------------------------------
// isVipActive / hasAdvancedFilters / hasProfileVisitors / isEffectivelyBoosted /
// depositLink / insufficientBalanceText / chargeMatchUser: see src/lib/match/entitlements.ts.

// ---------------------------------------------------------------------
// Profile wizard
// ---------------------------------------------------------------------
const PROFILE_STEP_ORDER: ProfileStep[] = [
  "gender", "name", "age", "country", "job", "education", "attributes",
  "city", "maritalStatus", "contactMethod", "contactValue", "photo", "voice",
];
function nextProfileStep(step: ProfileStep): ProfileStep | null {
  const i = PROFILE_STEP_ORDER.indexOf(step);
  return i >= 0 && i + 1 < PROFILE_STEP_ORDER.length ? PROFILE_STEP_ORDER[i + 1] : null;
}
async function askProfileStep(bot: TelegramBot, chatId: number, step: ProfileStep) {
  switch (step) {
    case "gender":
      await bot.api.sendMessage(chatId, "👤 إنشاء ملفك الشخصي\n\nما هو جنسك؟", { reply_markup: genderMenu() });
      break;
    case "name":
      await bot.api.sendMessage(chatId, "أرسل اسمك:", { reply_markup: plainBackMenu() });
      break;
    case "age":
      await bot.api.sendMessage(chatId, "أرسل عمرك (رقماً):", { reply_markup: plainBackMenu() });
      break;
    case "country":
      await bot.api.sendMessage(chatId, "🌍 اختر دولتك، أو اكتبها يدوياً:", { reply_markup: choiceMenu(COUNTRY_CHOICES, 3) });
      break;
    case "job":
      await bot.api.sendMessage(chatId, "💼 اختر مجال عملك، أو اكتبه يدوياً:", { reply_markup: choiceMenu(JOB_CHOICES, 3, { skip: true }) });
      break;
    case "education":
      await bot.api.sendMessage(chatId, "🎓 اختر مستواك التعليمي، أو اكتبه يدوياً:", { reply_markup: choiceMenu(EDUCATION_CHOICES, 2, { skip: true }) });
      break;
    case "attributes":
      await bot.api.sendMessage(chatId, "أرسل وصفاً موجزاً لمواصفاتك (الطول، اللون، إلخ):", { reply_markup: skipMenu() });
      break;
    case "city":
      await bot.api.sendMessage(chatId, "أرسل مدينة سكنك (اختياري):", { reply_markup: skipMenu() });
      break;
    case "maritalStatus":
      await bot.api.sendMessage(chatId, "💍 اختر حالتك الاجتماعية (اختياري):", { reply_markup: choiceMenu(MARITAL_CHOICES, 2, { skip: true }) });
      break;
    case "contactMethod":
      await bot.api.sendMessage(chatId, "ما هي وسيلة التواصل التي تفضلها لتلقي الرسائل؟", { reply_markup: contactMethodMenu() });
      break;
    case "contactValue":
      await bot.api.sendMessage(chatId, "أرسل معرّفك في تلجرام (@username) أو رقم هاتفك على واتساب:", { reply_markup: plainBackMenu() });
      break;
    case "photo":
      await bot.api.sendMessage(chatId, "أرسل صورة شخصية لملفك (اختياري):", { reply_markup: photoStepMenu() });
      break;
    case "voice":
      await bot.api.sendMessage(
        chatId,
        "🎙 أرسل رسالة صوتية قصيرة (حوالي 15 ثانية) تعرّف فيها بنفسك وبما تبحث عنه — اختياري، ويمنح الطرف الآخر انطباعاً حقيقياً عنك قبل بدء الحديث:",
        { reply_markup: photoStepMenu() }
      );
      break;
  }
}

async function startProfileWizard(bot: TelegramBot, chatId: number, userId: string) {
  await setPending(userId, { mode: "profile_wizard", step: "gender", data: {} });
  await askProfileStep(bot, chatId, "gender");
}

async function saveProfile(bot: TelegramBot, chatId: number, userId: string, data: ProfileDraft) {
  const shared = {
    gender: data.gender!,
    name: data.name!,
    age: data.age!,
    country: data.country!,
    job: data.job ?? null,
    education: data.education ?? null,
    attributes: data.attributes ?? null,
    city: data.city ?? null,
    maritalStatus: data.maritalStatus ?? null,
    contactMethod: data.contactMethod!,
    contactValue: data.contactValue!,
  };
  // Owner decision (2026-10-11): profiles go live immediately so the search is
  // never empty because of the review queue; the admin still gets every new or
  // changed profile with ✅/❌ buttons and can reject afterwards. Editing keeps
  // an approved profile approved; only a previously REJECTED profile goes back
  // to manual review (so a rejection cannot be bypassed by re-saving).
  const existing = await prisma.matchProfile.findUnique({ where: { userId } });
  const status = existing?.status === "REJECTED" ? "PENDING" : "APPROVED";
  const sensitiveChanged =
    !existing || existing.name !== shared.name || (existing.attributes ?? null) !== shared.attributes || !!data.photoFileId || !!data.voiceFileId;
  await prisma.matchProfile.upsert({
    where: { userId },
    update: { ...shared, status, ...(data.photoFileId ? { photoFileId: data.photoFileId } : {}), ...(data.voiceFileId ? { voiceFileId: data.voiceFileId } : {}) },
    create: { userId, ...shared, status, photoFileId: data.photoFileId ?? null, voiceFileId: data.voiceFileId ?? null },
  });
  await setPending(userId, null);
  await bot.api.sendMessage(
    chatId,
    status === "APPROVED"
      ? "✅ تم حفظ ملفك الشخصي وهو الآن ظاهر في البحث. يمكنك الضغط على «🔍 البحث عن شريك»."
      : "✅ تم حفظ ملفك الشخصي، وهو قيد المراجعة من إدارة البوت لأنه رُفض سابقاً. سيصلك إشعار فور اعتماده.",
    { reply_markup: mainMenu() }
  );
  if (status === "APPROVED" && !existing) await grantReferralReward(bot, userId);
  if (SUPER_ADMIN_ID && (status === "PENDING" || sensitiveChanged)) {
    const profile = await prisma.matchProfile.findUnique({ where: { userId } });
    if (profile) await notifyAdminNewProfile(bot, profile);
  }
}

export async function notifyAdminNewProfile(bot: TelegramBot, profile: MatchProfile) {
  // Buttons carry the full userId in callback_data — see handleAdminCallback.
  // The text commands (موافقة ملف/رفض ملف <رمز>) still work too, as a
  // fallback for whenever a message with buttons has scrolled out of view.
  const text =
    (profile.status === "PENDING" ? `👤 ملف بانتظار المراجعة` : `👤 ملف جديد/معدَّل (ظاهر في البحث — ارفضه إن خالف الشروط)`) + ` #${shortId(profile.userId)}\n\n` +
    `الاسم: ${profile.name}\nالجنس: ${profile.gender === "MALE" ? "ذكر" : "أنثى"}\nالعمر: ${profile.age}\nالدولة: ${profile.country}\n` +
    `العمل: ${profile.job || "غير محدد"}\nالتعليم: ${profile.education || "غير محدد"}\nالمواصفات: ${profile.attributes || "غير محدد"}\n` +
    `التواصل: ${profile.contactMethod === "TELEGRAM" ? "تلجرام" : "واتساب"} — ${profile.contactValue}`;
  const kb = new InlineKeyboard().text("✅ قبول", `madmin_approve|${profile.userId}`).text("❌ رفض", `madmin_reject|${profile.userId}`);
  try {
    // Duplicates: an older pending card for the same profile is removed before the new one.
    await clearReviewCards(bot, profile.userId, "↪️ استُبدل ببطاقة أحدث").catch(() => null);
    const sent = profile.photoFileId
      ? await bot.api.sendPhoto(Number(SUPER_ADMIN_ID), profile.photoFileId, { caption: text, reply_markup: kb })
      : await bot.api.sendMessage(Number(SUPER_ADMIN_ID), text, { reply_markup: kb });
    if (sent?.message_id) await storeReviewCard(profile.userId, Number(SUPER_ADMIN_ID), [sent.message_id]).catch(() => null);
    // Admin review is always the one context that sees the real photo
    // directly (the consent-gating on sendSearchCard is for other members
    // browsing search results, not for moderation) — same for the voice
    // intro, so the admin can actually judge it before approving.
    if (profile.voiceFileId) {
      const v = await bot.api.sendVoice(Number(SUPER_ADMIN_ID), profile.voiceFileId).catch(() => null);
      if (v?.message_id) await storeReviewCard(profile.userId, Number(SUPER_ADMIN_ID), [v.message_id]).catch(() => null);
    }
  } catch {
    // admin unreachable — not fatal, they can still review later once they message the bot
  }
}

async function consumeProfileStep(bot: TelegramBot, chatId: number, userId: string, pending: Extract<PendingAction, { mode: "profile_wizard" }>, text: string) {
  const { step, data } = pending;
  if (isManual(text)) {
    await bot.api.sendMessage(chatId, "✍️ اكتب إجابتك الآن:", { reply_markup: plainBackMenu() });
    return;
  }
  if (step === "gender") {
    if (text !== "👨 ذكر" && text !== "👩 أنثى") {
      await bot.api.sendMessage(chatId, "اختر من القائمة.", { reply_markup: genderMenu() });
      return;
    }
    data.gender = text === "👨 ذكر" ? "MALE" : "FEMALE";
  } else if (step === "name") {
    if (!text) return;
    data.name = text;
  } else if (step === "age") {
    const age = Number(text.replace(/[^0-9]/g, ""));
    if (!Number.isFinite(age) || age < 18 || age > 100) {
      await bot.api.sendMessage(chatId, "أرسل عمراً صحيحاً (18 فأكثر).");
      return;
    }
    data.age = age;
  } else if (step === "country") {
    if (!text) return;
    data.country = text;
  } else if (step === "job") {
    data.job = isSkip(text) ? null : text;
  } else if (step === "education") {
    data.education = isSkip(text) ? null : text;
  } else if (step === "attributes") {
    data.attributes = isSkip(text) ? null : text;
    if (data.attributes && novaAssistConfigured()) {
      await bot.api.sendChatAction(chatId, "typing").catch(() => null);
      const suggestion = await improveListingText(userId, "نبذة تعريفية شخصية", data.attributes);
      if (suggestion.ok && suggestion.text && suggestion.text !== data.attributes) {
        await setPending(userId, { mode: "attributes_ai_review", data, step, suggested: suggestion.text });
        await bot.api.sendMessage(
          chatId,
          `📝 نبذتك:\n${data.attributes}\n\n✨ اقتراح نوفا (ذكاء اصطناعي) لتحسينها:\n${suggestion.text}\n\nأي نسخة تريد استخدامها؟`,
          { reply_markup: new InlineKeyboard().text("📝 نبذتي الأصلية", "matai_use|orig").row().text("✨ نسخة نوفا المحسّنة", "matai_use|ai") }
        );
        return;
      }
    }
  } else if (step === "city") {
    data.city = isSkip(text) ? null : text;
  } else if (step === "maritalStatus") {
    data.maritalStatus = isSkip(text) ? null : text;
  } else if (step === "contactMethod") {
    if (text !== "✈️ تلجرام" && text !== "💬 واتساب") {
      await bot.api.sendMessage(chatId, "اختر من القائمة.", { reply_markup: contactMethodMenu() });
      return;
    }
    data.contactMethod = text === "✈️ تلجرام" ? "TELEGRAM" : "WHATSAPP";
  } else if (step === "contactValue") {
    if (!text) return;
    data.contactValue = data.contactMethod === "WHATSAPP" ? text.replace(/[^0-9+]/g, "") : text.replace(/^@/, "");
  } else if (step === "photo") {
    // An actual photo attachment is caught earlier in the main dispatcher
    // before this function ever runs — any text reaching here (the skip
    // button, or anything else) means "no photo".
  } else if (step === "voice") {
    // Same pattern as "photo" above — an actual voice message is caught
    // earlier in the main dispatcher; text reaching here means "no voice intro".
  }

  await advanceProfileStep(bot, chatId, userId, step, data);
}

async function advanceProfileStep(bot: TelegramBot, chatId: number, userId: string, step: ProfileStep, data: ProfileDraft) {
  const next = nextProfileStep(step);
  if (!next) {
    await saveProfile(bot, chatId, userId, data);
    return;
  }
  await setPending(userId, { mode: "profile_wizard", step: next, data });
  await askProfileStep(bot, chatId, next);
}

// ---------------------------------------------------------------------
// Partner-preference wizard
// ---------------------------------------------------------------------
const PREF_STEP_ORDER: PrefStep[] = ["country", "ageMin", "ageMax", "job", "education", "attributes"];
function nextPrefStep(step: PrefStep): PrefStep | null {
  const i = PREF_STEP_ORDER.indexOf(step);
  return i >= 0 && i + 1 < PREF_STEP_ORDER.length ? PREF_STEP_ORDER[i + 1] : null;
}
async function askPrefStep(bot: TelegramBot, chatId: number, step: PrefStep, gender: Gender | undefined) {
  const you = gender === "FEMALE" ? "أنتِ" : "أنت";
  switch (step) {
    case "country":
      await bot.api.sendMessage(chatId, `💍 مواصفات الشريك الذي تبحث عنه\n\nما الدولة التي يفضّل ${you} أن يكون منها الشريك؟ اختر أو اكتبها يدوياً:`, { reply_markup: choiceMenu(COUNTRY_CHOICES, 3) });
      break;
    case "ageMin":
      await bot.api.sendMessage(chatId, "الحد الأدنى للعمر المطلوب:", { reply_markup: choiceMenu(AGE_CHOICES, 4, { skip: true }) });
      break;
    case "ageMax":
      await bot.api.sendMessage(chatId, "الحد الأقصى للعمر المطلوب:", { reply_markup: choiceMenu(AGE_CHOICES, 4, { skip: true }) });
      break;
    case "job":
      await bot.api.sendMessage(chatId, `ما العمل الذي ${you === "أنتِ" ? "تفضّلينه" : "تفضّله"} في الشريك؟ اختر أو اكتبه يدوياً:`, { reply_markup: choiceMenu(JOB_CHOICES, 3, { skip: true }) });
      break;
    case "education":
      await bot.api.sendMessage(chatId, "المستوى التعليمي المطلوب:", { reply_markup: choiceMenu(EDUCATION_CHOICES, 2, { skip: true }) });
      break;
    case "attributes":
      await bot.api.sendMessage(chatId, "المواصفات الأخرى المطلوبة (الطول، اللون، إلخ):", { reply_markup: skipMenu() });
      break;
  }
}
async function startPrefWizard(bot: TelegramBot, chatId: number, userId: string, gender: Gender | undefined) {
  await setPending(userId, { mode: "pref_wizard", step: "country", data: {} });
  await askPrefStep(bot, chatId, "country", gender);
}
async function savePref(bot: TelegramBot, chatId: number, userId: string, data: PrefDraft) {
  await prisma.partnerPreference.upsert({
    where: { userId },
    update: { country: data.country!, ageMin: data.ageMin ?? null, ageMax: data.ageMax ?? null, job: data.job ?? null, education: data.education ?? null, attributes: data.attributes ?? null },
    create: { userId, country: data.country!, ageMin: data.ageMin ?? null, ageMax: data.ageMax ?? null, job: data.job ?? null, education: data.education ?? null, attributes: data.attributes ?? null },
  });
  await setPending(userId, null);
  await bot.api.sendMessage(chatId, "✅ تم حفظ مواصفات الشريك. يمكنك الآن الضغط على «🔍 البحث عن شريك».", { reply_markup: mainMenu() });
}
async function consumePrefStep(bot: TelegramBot, chatId: number, userId: string, pending: Extract<PendingAction, { mode: "pref_wizard" }>, text: string, gender: Gender | undefined) {
  const { step, data } = pending;
  if (isManual(text)) {
    await bot.api.sendMessage(chatId, "✍️ اكتب إجابتك الآن:", { reply_markup: plainBackMenu() });
    return;
  }
  if (step === "country") {
    if (!text) return;
    data.country = text;
  } else if (step === "ageMin") {
    data.ageMin = isSkip(text) ? null : Number(text.replace(/[^0-9]/g, "")) || null;
  } else if (step === "ageMax") {
    data.ageMax = isSkip(text) ? null : Number(text.replace(/[^0-9]/g, "")) || null;
  } else if (step === "job") {
    data.job = isSkip(text) ? null : text;
  } else if (step === "education") {
    data.education = isSkip(text) ? null : text;
  } else if (step === "attributes") {
    data.attributes = isSkip(text) ? null : text;
  }
  const next = nextPrefStep(step);
  if (!next) {
    await savePref(bot, chatId, userId, data);
    return;
  }
  await setPending(userId, { mode: "pref_wizard", step: next, data });
  await askPrefStep(bot, chatId, next, gender);
}

// ---------------------------------------------------------------------
// Search matching engine
// ---------------------------------------------------------------------
function looseMatch(candidateValue: string | null, wanted: string | null | undefined): boolean {
  if (!wanted) return true; // "لا يهم"
  if (!candidateValue) return false;
  return candidateValue.toLowerCase().includes(wanted.toLowerCase()) || wanted.toLowerCase().includes(candidateValue.toLowerCase());
}
function ageInRange(age: number, min: number | null | undefined, max: number | null | undefined): boolean {
  if (min != null && age < min) return false;
  if (max != null && age > max) return false;
  return true;
}

// Weighted-random ordering instead of hard elimination (owner request,
// 2026-09-30): a profile that does not literally match every typed
// requirement used to be dropped, so searches looked empty. Now only gender,
// blocks and hidden/unapproved profiles are excluded; everything else
// (country, age, job, education, attributes, and the paid city/marital
// filters) only changes how LIKELY a profile is to come up. Each search gets
// a fresh random order (Efraimidis–Spirakis weighted shuffle), so better
// matches tend to appear first but every profile can be reached.
function norm(v: string | null | undefined): string {
  return (v || "").trim().toLowerCase();
}
function ageDistance(age: number, min: number | null | undefined, max: number | null | undefined): number {
  if (min != null && age < min) return min - age;
  if (max != null && age > max) return age - max;
  return 0;
}
const SEARCH_POOL_LIMIT = 1500;
const SEARCH_QUEUE_LIMIT = 300;

// Owners who chose "show my profile to my country only" (MatchProfilePrivacy).
// Kept in its own table and read defensively: before the migration is run the
// query fails and simply nobody is restricted.
async function countryOnlyOwners(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  try {
    const rows = await prisma.matchProfilePrivacy.findMany({ where: { userId: { in: ids }, countryOnly: true }, select: { userId: true } });
    return new Set(rows.map((r) => r.userId));
  } catch {
    return new Set();
  }
}

// strict = "🎯 بحث دقيق" (paid): the original all-requirements-must-match
// filter. Normal search only weights them.
// genderMode (Mini App only): "all" = mixed cards, or an explicit gender (paid 🚻 filter).
// The bot never passes it, so its search stays opposite-gender exactly as before.
export async function buildSearchQueue(botId: string, selfId: string, selfProfile: MatchProfile, selfPref: PartnerPreference, strict = false, genderMode?: "all" | Gender): Promise<string[]> {
  const oppositeGender: Gender = selfProfile.gender === "MALE" ? "FEMALE" : "MALE";
  const where = { status: "APPROVED", isHidden: false, ...(genderMode === "all" ? {} : { gender: genderMode ?? oppositeGender }), userId: { not: selfId }, user: { botId } };

  const total = await prisma.matchProfile.count({ where });
  const candidates = await prisma.matchProfile.findMany({
    where,
    include: { user: true },
    skip: total > SEARCH_POOL_LIMIT ? Math.floor(Math.random() * (total - SEARCH_POOL_LIMIT)) : 0,
    take: SEARCH_POOL_LIMIT,
  });

  const blocks = await prisma.matchBlock.findMany({ where: { OR: [{ blockerId: selfId }, { blockedId: selfId }] } });
  const blockedIds = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]).filter((id) => id !== selfId));

  const selfUser = await prisma.matchUser.findUnique({ where: { id: selfId } });
  const useAdvancedFilters = selfUser ? hasAdvancedFilters(selfUser) : false;
  const wantedCountry = norm(selfPref.country);
  const now = Date.now();

  // Fair, not forced: profiles this user saw in the last 7 days come up less
  // often (never excluded -- they can still reappear), and profiles that few
  // people have viewed get a small lift so nobody stays buried at the end.
  const ids = candidates.map((c) => c.userId);
  const [recentSeen, exposure] = await Promise.all([
    prisma.matchProfileVisit.findMany({
      where: { viewerId: selfId, visitedAt: { gte: new Date(now - 7 * 86400000) } },
      select: { ownerId: true },
    }),
    prisma.matchProfileVisit.groupBy({ by: ["ownerId"], where: { ownerId: { in: ids } }, _count: { _all: true } }),
  ]);
  const seenSet = new Set(recentSeen.map((v) => v.ownerId));
  const countryOnly = await countryOnlyOwners(ids);
  const selfCountry = norm(selfProfile.country);
  const exposureOf = new Map(exposure.map((e) => [e.ownerId, e._count._all]));

  const ranked: { id: string; key: number }[] = [];
  for (const c of candidates) {
    if (blockedIds.has(c.userId)) continue;
    if (countryOnly.has(c.userId) && norm(c.country) !== selfCountry) continue;
    if (strict) {
      if (norm(c.country) !== wantedCountry) continue;
      if (!ageInRange(c.age, selfPref.ageMin, selfPref.ageMax)) continue;
      if (!looseMatch(c.job, selfPref.job)) continue;
      if (!looseMatch(c.education, selfPref.education)) continue;
      if (!looseMatch(c.attributes, selfPref.attributes)) continue;
      if (!looseMatch(c.city, selfPref.city)) continue;
      if (!looseMatch(c.maritalStatus, selfPref.maritalStatus)) continue;
    }

    let w = 1;
    w *= norm(c.country) === wantedCountry ? 3 : 0.5;
    const dist = ageDistance(c.age, selfPref.ageMin, selfPref.ageMax);
    w *= dist === 0 ? 3 : dist <= 3 ? 1.5 : dist <= 7 ? 0.8 : 0.3;
    if (selfPref.job) w *= looseMatch(c.job, selfPref.job) ? 1.6 : 0.8;
    if (selfPref.education) w *= looseMatch(c.education, selfPref.education) ? 1.6 : 0.8;
    if (selfPref.attributes) w *= looseMatch(c.attributes, selfPref.attributes) ? 1.6 : 0.8;
    if (useAdvancedFilters) {
      if (selfPref.city) w *= looseMatch(c.city, selfPref.city) ? 1.8 : 0.3;
      if (selfPref.maritalStatus) w *= looseMatch(c.maritalStatus, selfPref.maritalStatus) ? 1.8 : 0.3;
    }
    if (isEffectivelyBoosted(c, c.user)) w *= 2.5;
    if (c.verificationStatus === "VERIFIED") w *= 1.3;
    if (now - c.user.lastActiveAt.getTime() < 3 * 86400000) w *= 1.3;
    // Recently refreshed profiles get a small lift so stale ones don't crowd the top.
    if (c.updated_at && now - new Date(c.updated_at).getTime() < 14 * 86400000) w *= 1.2;
    if (seenSet.has(c.userId)) w *= 0.35;
    w *= Math.max(0.6, Math.min(1.6, 1.6 / (1 + (exposureOf.get(c.userId) || 0) / 25)));

    ranked.push({ id: c.userId, key: Math.pow(Math.random(), 1 / w) });
  }
  ranked.sort((a, b) => b.key - a.key);
  return ranked.slice(0, SEARCH_QUEUE_LIMIT).map((r) => r.id);
}

// Share of the searcher's stated preferences this profile meets (0-100),
// shown on the card as "💞 توافق X%". Country and age count double; age
// outside the range still earns partial credit when it is close.
export function compatibilityPercent(profile: MatchProfile, pref: PartnerPreference | null, advanced: boolean): number | null {
  if (!pref) return null;
  let got = 0;
  let total = 0;
  const add = (weight: number, score: number) => { total += weight; got += weight * score; };
  add(2, norm(profile.country) === norm(pref.country) ? 1 : 0);
  if (pref.ageMin != null || pref.ageMax != null) {
    const d = ageDistance(profile.age, pref.ageMin, pref.ageMax);
    add(2, d === 0 ? 1 : d <= 3 ? 0.6 : d <= 7 ? 0.3 : 0);
  }
  if (pref.job) add(1, looseMatch(profile.job, pref.job) ? 1 : 0);
  if (pref.education) add(1, looseMatch(profile.education, pref.education) ? 1 : 0);
  if (pref.attributes) add(1, looseMatch(profile.attributes, pref.attributes) ? 1 : 0);
  if (advanced && pref.city) add(1, looseMatch(profile.city, pref.city) ? 1 : 0);
  if (advanced && pref.maritalStatus) add(1, looseMatch(profile.maritalStatus, pref.maritalStatus) ? 1 : 0);
  if (!total) return null;
  return Math.max(20, Math.round((got / total) * 100));
}

function likeButtonLabel(count: number): string {
  return `❤️ إعجاب (${count})`;
}

// Seriousness Score (owner spec, 2026-09-05) — a trust signal computed
// entirely from data that already exists (profile completeness, phone
// verification, report history). No new user input, nothing a user can
// directly game by claiming anything — it's the same honest-signal
// approach as the Verified Badge, just free and automatic. Capped at
// 100; a 40-point floor for reaching an APPROVED profile at all (the only
// state this function is ever called for), minus up to 30 for reports.
function computeSeriousnessScore(profile: MatchProfile, user: MatchUser, reportsReceived: number): number {
  let score = 40;
  if (user.phoneVerified) score += 20;
  if (profile.photoFileId) score += 15;
  if (profile.job) score += 8;
  if (profile.education) score += 8;
  if (profile.attributes) score += 9;
  score -= Math.min(30, reportsReceived * 10);
  return Math.max(0, Math.min(100, score));
}

function seriousnessLabel(score: number): string {
  if (score >= 80) return `🟢 مؤشر الجدية: مرتفع (${score}%)`;
  if (score >= 50) return `🟡 مؤشر الجدية: متوسط (${score}%)`;
  return `🟠 مؤشر الجدية: أساسي (${score}%)`;
}

const SITE_ORIGIN = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
const PHOTO_LOCKED = `${SITE_ORIGIN}/img/match-locked.jpg`;
const PHOTO_NONE = `${SITE_ORIGIN}/img/match-nophoto.jpg`;

const clip = (v: string, n: number) => (v.length > n ? v.slice(0, n - 1) + "…" : v);

// Every search card is a PHOTO message (the real photo once access is granted,
// otherwise a neutral placeholder picture), so "next" can swap the card in
// place with editMessageMedia instead of deleting and re-sending a message.
async function buildSearchCard(targetUserId: string, viewerId: string, expanded = false): Promise<{ photo: string; caption: string; kb: InlineKeyboard } | null> {
  const [profile, targetUser, likeCount, reportsReceived, photoPermission, viewerPref, viewerUser] = await Promise.all([
    prisma.matchProfile.findUnique({ where: { userId: targetUserId } }),
    prisma.matchUser.findUnique({ where: { id: targetUserId } }),
    prisma.matchLike.count({ where: { toUserId: targetUserId } }),
    prisma.matchReport.count({ where: { targetId: targetUserId } }),
    prisma.matchPhotoPermission.findUnique({ where: { ownerId_viewerId: { ownerId: targetUserId, viewerId } } }),
    prisma.partnerPreference.findUnique({ where: { userId: viewerId } }),
    prisma.matchUser.findUnique({ where: { id: viewerId } }),
  ]);
  if (!profile || !targetUser) return null;

  const viewerOwn = viewerPref ? null : await prisma.matchProfile.findUnique({ where: { userId: viewerId } });
  const pct = compatibilityPercent(profile, viewerPref ?? (viewerOwn ? defaultPref(viewerId, viewerOwn) : null), viewerUser ? hasAdvancedFilters(viewerUser) : false);
  const head = [
    `👤 ${profile.name}، ${profile.age}${profile.verificationStatus === "VERIFIED" ? " ☑️" : ""}`,
    `🌍 ${profile.country}${profile.city ? ` · ${clip(profile.city, 40)}` : ""}`,
    pct != null ? `💞 توافق ${pct}%` : null,
    presenceLabel(targetUser.lastActiveAt),
  ];
  // Short card by default; the full text sits behind "📖 المزيد" so the card
  // stays compact and the buttons do not jump around between profiles.
  const details = expanded
    ? [
        profile.job ? `💼 ${clip(profile.job, 80)}` : null,
        profile.education ? `🎓 ${clip(profile.education, 80)}` : null,
        profile.maritalStatus ? `💍 ${clip(profile.maritalStatus, 40)}` : null,
        profile.attributes ? `📝 ${clip(profile.attributes, 400)}` : null,
        seriousnessLabel(computeSeriousnessScore(profile, targetUser, reportsReceived)),
        isEffectivelyBoosted(profile, targetUser) ? "🚀 ملف مرفوع" : null,
      ]
    : [];
  const lines = [...head, ...(details.length ? [""] : []), ...details].filter((l): l is string => l !== null);

  // Callback data carries the full Telegram ID, not a shortId suffix — a
  // 6-char suffix of a plain numeric Telegram ID (unlike a UUID) has real
  // collision risk between different users; the full ID easily fits
  // Telegram's 64-byte callback_data limit anyway.
  const kb = new InlineKeyboard();
  kb.text(likeButtonLabel(likeCount), `mlike|${targetUserId}`).text(expanded ? "🔼 إخفاء" : "📖 معلومات", `${expanded ? "mless" : "mmore"}|${targetUserId}`).text(`⭐`, `msuperlike|${targetUserId}`).row();
  const contactUrl = profile.contactMethod === "TELEGRAM" ? `https://t.me/${profile.contactValue.replace(/^@/, "")}` : `https://wa.me/${profile.contactValue.replace(/[^0-9]/g, "")}`;
  kb.url("💬 رسالة", contactUrl).row();
  const photoGranted = photoPermission?.status === "GRANTED";
  if (profile.voiceFileId) kb.text("🎙 صوت", `mvoice|${targetUserId}`);
  if (photoGranted && (profile.photoFileId2 || profile.photoFileId3)) kb.text("🖼 صور أخرى", `mphotos|${targetUserId}`);
  if (profile.photoFileId && !photoGranted) kb.text("🔒 اطلب رؤية الصورة", `mphotoreq|${targetUserId}`);
  kb.row();
  // The profile id rides on "next" so a double tap on the same card is
  // recognised and ignored instead of skipping a profile.
  kb.text("↩️ السابق", "mrewind").text("➡️ الملف التالي", `mnext|${targetUserId}`).row();
  kb.text("🚩 إبلاغ", `mreport|${targetUserId}`).text("⛔ حظر", `mblock|${targetUserId}`);

  // Photo access is consent-gated (owner spec, 2026-09-05): the real photo is
  // never used until the profile owner explicitly grants this viewer.
  const photo = profile.photoFileId && photoGranted ? profile.photoFileId : profile.photoFileId ? PHOTO_LOCKED : PHOTO_NONE;
  const status = profile.photoFileId && !photoGranted ? "🔒 الصورة مخفية — اطلب إذن صاحب الملف\n\n" : !profile.photoFileId ? "📷 بلا صورة\n\n" : "";
  return { photo, caption: status + lines.join("\n"), kb };
}

// Records the visit for the paid "who viewed my profile" feature (skipped
// while the VIEWER has incognito active -- their own activity, not the
// profile owner's, is what incognito hides).
export async function trackProfileVisit(targetUserId: string, viewerId: string) {
  const viewer = await prisma.matchUser.findUnique({ where: { id: viewerId }, include: { profile: true } });
  const viewerIncognito = !!viewer && !!viewer.profile?.isIncognito && isVipActive(viewer);
  if (targetUserId !== viewerId && !viewerIncognito) {
    await prisma.matchProfileVisit
      .upsert({
        where: { ownerId_viewerId: { ownerId: targetUserId, viewerId } },
        update: { visitedAt: new Date() },
        create: { ownerId: targetUserId, viewerId },
      })
      .catch(() => null);
  }
}

/**
 * Shows a profile card. With a messageId the card that was on screen is
 * REPLACED IN PLACE (editMessageMedia: photo, caption and buttons swap in one
 * step, the message and its "next" button never move). If that edit is not
 * possible (an old text-style card, or the message is gone) a new card is
 * sent instead.
 */
async function sendSearchCard(bot: TelegramBot, chatId: number, targetUserId: string, viewerId: string, messageId?: number): Promise<number | null> {
  const card = await buildSearchCard(targetUserId, viewerId);
  if (!card) return null;
  let shownId: number | null = null;
  if (messageId) {
    try {
      await bot.api.editMessageMedia(chatId, messageId, { type: "photo", media: card.photo, caption: card.caption }, { reply_markup: card.kb });
      shownId = messageId;
    } catch (e) {
      if (/message is not modified/i.test(String((e as Error)?.message || ""))) shownId = messageId;
    }
  }
  if (shownId == null) {
    const m = await bot.api.sendPhoto(chatId, card.photo, { caption: card.caption, reply_markup: card.kb });
    shownId = m.message_id;
  }
  await trackProfileVisit(targetUserId, viewerId);
  return shownId;
}

// Used when the user never filled in partner preferences: own country only.
export function defaultPref(userId: string, profile: MatchProfile): PartnerPreference {
  return { id: "", userId, country: profile.country, ageMin: null, ageMax: null, job: null, education: null, attributes: null, city: null, maritalStatus: null, updated_at: new Date() } as PartnerPreference;
}

async function advanceSearch(bot: TelegramBot, chatId: number, userId: string, pending: Extract<PendingAction, { mode: "search_browsing" }>, messageId?: number) {
  let queue = pending.queue;
  let idx = pending.index;
  let refilled = false;
  for (;;) {
    while (idx < queue.length) {
      const targetId = queue[idx];
      const stillBlocked = await isMutuallyBlocked(userId, targetId);
      const stillApproved = await prisma.matchProfile.findUnique({ where: { userId: targetId }, select: { status: true } });
      if (!stillBlocked && stillApproved?.status === "APPROVED") {
        const shown = await sendSearchCard(bot, chatId, targetId, userId, messageId);
        if (shown != null) {
          await setPending(userId, { mode: "search_browsing", queue, index: idx + 1, current: targetId, msgId: shown, strict: pending.strict });
          return;
        }
      }
      idx++;
    }
    // Reached the end of this shuffle: draw a fresh random order instead of
    // stopping, so browsing never dead-ends while profiles exist.
    if (refilled) break;
    refilled = true;
    const [me, prof, pref] = await Promise.all([
      prisma.matchUser.findUnique({ where: { id: userId }, select: { botId: true } }),
      prisma.matchProfile.findUnique({ where: { userId } }),
      prisma.partnerPreference.findUnique({ where: { userId } }),
    ]);
    if (!me || !prof || (!pref && pending.strict)) break;
    const fresh = await buildSearchQueue(me.botId, userId, prof, pref ?? defaultPref(userId, prof), !!pending.strict);
    if (fresh.length === 0) break;
    queue = fresh;
    idx = 0;
  }
  await setPending(userId, null);
  await bot.api.sendMessage(chatId, "🔚 لا توجد ملفات لعرضها حالياً. عد لاحقاً لترى الجديد.", { reply_markup: mainMenu() });
}

async function startSearch(bot: TelegramBot, chatId: number, userId: string, botId: string, messageId?: number, strict = false) {
  const [profile, pref] = await Promise.all([
    prisma.matchProfile.findUnique({ where: { userId } }),
    prisma.partnerPreference.findUnique({ where: { userId } }),
  ]);
  if (!profile || profile.status !== "APPROVED") {
    await bot.api.sendMessage(chatId, "⚠️ يجب إنشاء ملفك الشخصي واعتماده من الإدارة أولاً.", { reply_markup: mainMenu() });
    return;
  }
  // Partner preferences are optional for a normal search: without them we
  // search with the user's own country and nothing else, instead of refusing.
  // (The precise search still needs real preferences to be meaningful.)
  if (!pref && strict) {
    await bot.api.sendMessage(chatId, "⚠️ البحث الدقيق يحتاج مواصفات الشريك. حدّدها من «💍 مواصفات الشريك» أولاً.", { reply_markup: mainMenu() });
    return;
  }
  const effectivePref: PartnerPreference = pref ?? defaultPref(userId, profile);
  const queue = await buildSearchQueue(botId, userId, profile, effectivePref, strict);
  if (queue.length === 0) {
    if (strict) {
      await bot.api.sendMessage(chatId, "🎯 لا توجد ملفات تطابق كل مواصفاتك حرفياً الآن. جرّب «🔍 البحث عن شريك» لعرض الأقرب لها.", { reply_markup: mainMenu() });
      return;
    }
    // Say WHY it is empty instead of a vague "no results".
    const opposite: Gender = profile.gender === "MALE" ? "FEMALE" : "MALE";
    const visible = await prisma.matchProfile.count({ where: { status: "APPROVED", isHidden: false, gender: opposite, userId: { not: userId }, user: { botId } } });
    const me = await bot.api.getMe().catch(() => null);
    await bot.api.sendMessage(
      chatId,
      (visible === 0
        ? "🌿 لا توجد نتائج مطابقة في هذه اللحظة. يستقبل البوت ملفات جديدة كل يوم، وسنُعلمك فور توفر ملفات تناسبك، فعاود البحث لاحقاً بإذن الله."
        : "📭 لا توجد ملفات يمكن عرضها لك الآن (قد تكون محظورة أو مقيّدة بدولة أخرى).") +
        (me?.username ? `\n\nيمكنك دعوة من تثق بهم عبر رابطك الخاص، وستصلك رسالة عند انضمام ملفات جديدة:\nhttps://t.me/${me.username}?start=ref_${userId}` : ""),
      { reply_markup: mainMenu() }
    );
    return;
  }
  // Honest notice (friend's suggestion): when none of the first profiles meets
  // every stated requirement, say we are showing the closest ones instead.
  if (!strict) {
    const head = await prisma.matchProfile.findMany({ where: { userId: { in: queue.slice(0, 10) } } });
    const best = head.reduce((m, h) => Math.max(m, compatibilityPercent(h, effectivePref, false) ?? 0), 0);
    if (best < 100) {
      await bot.api
        .sendMessage(chatId, "ℹ️ لا يوجد ملف يطابق كل مواصفاتك بالضبط حالياً، فنعرض لك الأقرب إليها. نسبة التوافق ظاهرة على كل بطاقة.")
        .catch(() => null);
    }
  }
  await advanceSearch(bot, chatId, userId, { mode: "search_browsing", queue, index: 0, strict }, messageId);
}

// After a Super Like (sent, cancelled or unaffordable) the user returns to the
// same browsing session, so the "next" button on the card keeps working.
async function resumeBrowsing(userId: string, resume: { queue: string[]; index: number; current?: string; msgId?: number; strict?: boolean } | undefined): Promise<boolean> {
  if (!resume) return false;
  await setPending(userId, { mode: "search_browsing", ...resume });
  return true;
}

// Both people liked each other: tell both, once, with a button to message.
export async function notifyMutualLike(bot: TelegramBot, fromId: string, toId: string) {
  const back = await prisma.matchLike.findUnique({ where: { fromUserId_toUserId: { fromUserId: toId, toUserId: fromId } } });
  if (!back) return;
  const [a, b] = await Promise.all([
    prisma.matchProfile.findUnique({ where: { userId: fromId } }),
    prisma.matchProfile.findUnique({ where: { userId: toId } }),
  ]);
  if (!a || !b) return;
  const contactKb = (p: MatchProfile) =>
    new InlineKeyboard().url(
      "💬 راسل الآن",
      p.contactMethod === "TELEGRAM" ? `https://t.me/${p.contactValue.replace(/^@/, "")}` : `https://wa.me/${p.contactValue.replace(/[^0-9]/g, "")}`,
    );
  await bot.api.sendMessage(Number(fromId), `💞 إعجاب متبادل!\n\nأنت و«${b.name}» أُعجب كلٌّ منكما بالآخر.`, { reply_markup: contactKb(b) }).catch(() => null);
  await bot.api.sendMessage(Number(toId), `💞 إعجاب متبادل!\n\nأنت و«${a.name}» أُعجب كلٌّ منكما بالآخر.`, { reply_markup: contactKb(a) }).catch(() => null);
}

async function showLikedBy(bot: TelegramBot, chatId: number, userId: string) {
  const likes = await prisma.matchLike.findMany({ where: { toUserId: userId }, orderBy: { created_at: "desc" }, take: 20 });
  if (likes.length === 0) {
    await bot.api.sendMessage(chatId, "😔 لا يوجد أحد أعجب بملفك حتى الآن.", { reply_markup: mainMenu() });
    return;
  }
  await bot.api.sendMessage(chatId, `💌 عدد من أعجبوا بملفك: ${likes.length}`, { reply_markup: mainMenu() });
  for (const like of likes) {
    if (await isMutuallyBlocked(userId, like.fromUserId)) continue;
    const profile = await prisma.matchProfile.findUnique({ where: { userId: like.fromUserId } });
    if (!profile || profile.status !== "APPROVED" || profile.isHidden) continue;
    await sendSearchCard(bot, chatId, like.fromUserId, userId);
    if (like.note) {
      await bot.api.sendMessage(chatId, `⭐ رسالة سوبر لايك من ${profile.name}:\n\n${like.note}`).catch(() => null);
    }
  }
}

async function handleMatchCallback(bot: TelegramBot, botRow: BotRow, cq: any) {
  const chatId = cq.message?.chat?.id;
  const messageId = cq.message?.message_id;
  const tgUserId = String(cq.from.id);
  const data = String(cq.data || "");
  if (!chatId) return;

  if (data.startsWith("madmin_") || data.startsWith("mrep_") || data.startsWith("mverify_")) {
    if (!SUPER_ADMIN_ID || tgUserId !== SUPER_ADMIN_ID) {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    await handleAdminCallback(bot, botRow.id, chatId, data, cq);
    return;
  }

  if (data.startsWith("mstars|")) {
    const stars = Number(data.split("|")[1] || 0);
    if (stars > 0) {
      await sendStarsInvoice(bot, chatId, {
        title: "شحن رصيد بوت الزواج",
        description: `شحن $${usdForStars(stars).toFixed(2)} في رصيدك عبر نجوم تيليجرام`,
        payload: starsPayload("MATCH_DEPOSIT", tgUserId),
        stars,
      });
    }
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }

  const user = await ensureMatchUser(botRow.id, tgUserId);
  const pending = user.pendingAction as PendingAction | null;

  if (data.startsWith("matai_use|")) {
    if (pending?.mode !== "attributes_ai_review") {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    const choice = data.split("|")[1];
    const draftData = pending.data;
    if (choice === "ai") draftData.attributes = pending.suggested;
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    await advanceProfileStep(bot, chatId, tgUserId, pending.step, draftData);
    return;
  }

  if (data.startsWith("mlike|")) {
    const targetId = data.split("|")[1];
    const target = await prisma.matchProfile.findUnique({ where: { userId: targetId } });
    if (target) {
      const already = await prisma.matchLike.findUnique({ where: { fromUserId_toUserId: { fromUserId: tgUserId, toUserId: target.userId } } });
      await prisma.matchLike.upsert({
        where: { fromUserId_toUserId: { fromUserId: tgUserId, toUserId: target.userId } },
        update: {},
        create: { fromUserId: tgUserId, toUserId: target.userId },
      }).catch(() => null);
      if (!already) await notifyMutualLike(bot, tgUserId, target.userId);
      const count = await prisma.matchLike.count({ where: { toUserId: target.userId } });
      const kb = InlineKeyboard.from(cq.message.reply_markup.inline_keyboard);
      kb.inline_keyboard[0][0].text = likeButtonLabel(count);
      await bot.api.editMessageReplyMarkup(chatId, messageId, { reply_markup: kb }).catch(() => null);
    }
    await bot.api.answerCallbackQuery(cq.id, { text: "❤️ تم الإعجاب" }).catch(() => null);
    return;
  }
  if (data === "mnext" || data.startsWith("mnext|")) {
    const shownId = data.split("|")[1];
    const cardMsg = cq.message?.message_id;
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    if (pending?.mode === "search_browsing") {
      // A second tap on a card that has already moved on is ignored.
      if (shownId && pending.current && shownId !== pending.current && cardMsg === pending.msgId) return;
      if (shownId) await recordPass(tgUserId, shownId).catch(() => null); // for «↩️ السابق»
      await advanceSearch(bot, chatId, tgUserId, pending, cardMsg);
    } else {
      // No active browsing session (menu used meanwhile, old card): start a
      // fresh search right inside this same card instead of doing nothing.
      await startSearch(bot, chatId, tgUserId, botRow.id, cardMsg);
    }
    return;
  }
  if (data === "mrewind") {
    // ↩️ استرجاع آخر ملف تخطّيته — $PRICE_REWIND (same function as the app).
    const r = await purchaseRewind(tgUserId);
    if (!r.ok) {
      await bot.api.answerCallbackQuery(cq.id, { text: r.reason === "no_pass" ? "لا يوجد ملف سابق لاسترجاعه." : `رصيدك لا يكفي ($${PRICE_REWIND}).`, show_alert: r.reason !== "no_pass" }).catch(() => null);
      if (r.reason === "insufficient") await bot.api.sendMessage(chatId, insufficientBalanceText(tgUserId, r.needed, r.balance), { reply_markup: upgradesMenu() }).catch(() => null);
      return;
    }
    await bot.api.answerCallbackQuery(cq.id, { text: `↩️ تم الاسترجاع (-$${PRICE_REWIND})` }).catch(() => null);
    void trackFunnel(tgUserId, "rewind", undefined, "bot");
    const card = await buildSearchCard(r.targetId, tgUserId, false);
    if (card) await bot.api.sendPhoto(chatId, card.photo, { caption: card.caption, reply_markup: card.kb }).catch(() => null);
    return;
  }
  if (data.startsWith("mmore|") || data.startsWith("mless|")) {
    const targetId = data.split("|")[1];
    const card = await buildSearchCard(targetId, tgUserId, data.startsWith("mmore|"));
    if (card) {
      await bot.api.editMessageCaption(chatId, messageId, { caption: card.caption, reply_markup: card.kb }).catch(() => null);
    }
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("mreport|")) {
    const targetId = data.split("|")[1];
    const target = await prisma.matchProfile.findUnique({ where: { userId: targetId } });
    if (target) {
      await fileMatchReport(bot, tgUserId, target.userId, "SEARCH", `🚩 بلاغ جديد على ملف #${shortId(target.userId)} (${target.name}) من المستخدم ${tgUserId}.\nراجعه من «🚩 بلاغات المطابقة».`);
    }
    await bot.api.answerCallbackQuery(cq.id, { text: "🚩 تم إرسال بلاغك" }).catch(() => null);
    if (pending?.mode === "search_browsing") {
      await advanceSearch(bot, chatId, tgUserId, pending, cq.message?.message_id);
    }
    return;
  }
  if (data.startsWith("msuperlike|")) {
    const targetId = data.split("|")[1];
    const resume = pending?.mode === "search_browsing" ? { queue: pending.queue, index: pending.index, current: pending.current, msgId: pending.msgId, strict: pending.strict } : undefined;
    await setPending(tgUserId, { mode: "superlike_note", targetUserId: targetId, resume });
    await bot.api
      .sendMessage(chatId, `⭐ اكتب رسالة قصيرة ترافق إعجابك (سيُخصم $${PRICE_SUPER_LIKE} من رصيدك):`, { reply_markup: plainBackMenu() })
      .catch(() => null);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("mvoice|")) {
    const ownerId = data.split("|")[1];
    const prof = await prisma.matchProfile.findUnique({ where: { userId: ownerId }, select: { voiceFileId: true, status: true } });
    if (prof?.voiceFileId && prof.status === "APPROVED") await bot.api.sendVoice(chatId, prof.voiceFileId).catch(() => null);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("mphotos|")) {
    const ownerId = data.split("|")[1];
    const [prof, perm] = await Promise.all([
      prisma.matchProfile.findUnique({ where: { userId: ownerId }, select: { photoFileId2: true, photoFileId3: true, status: true } }),
      prisma.matchPhotoPermission.findUnique({ where: { ownerId_viewerId: { ownerId, viewerId: tgUserId } } }),
    ]);
    if (prof?.status === "APPROVED" && perm?.status === "GRANTED") {
      if (prof.photoFileId2) await bot.api.sendPhoto(chatId, prof.photoFileId2).catch(() => null);
      if (prof.photoFileId3) await bot.api.sendPhoto(chatId, prof.photoFileId3).catch(() => null);
    }
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("mphotoreq|")) {
    const ownerId = data.split("|")[1];
    await prisma.matchPhotoPermission
      .upsert({
        where: { ownerId_viewerId: { ownerId, viewerId: tgUserId } },
        update: {},
        create: { ownerId, viewerId: tgUserId, status: "PENDING" },
      })
      .catch(() => null);
    await bot.api
      .sendMessage(Number(ownerId), `🔒 يرغب أحد الأعضاء (#${shortId(tgUserId)}) برؤية صورتك في نتائج البحث. هل توافق؟`, {
        reply_markup: new InlineKeyboard().text("✅ نعم، اسمح بالرؤية", `mphotoyes|${tgUserId}`).text("❌ لا", `mphotono|${tgUserId}`),
      })
      .catch(() => null);
    await bot.api.answerCallbackQuery(cq.id, { text: "تم إرسال طلبك، بانتظار موافقة صاحب الملف" }).catch(() => null);
    return;
  }
  if (data.startsWith("mphotoyes|") || data.startsWith("mphotono|")) {
    const viewerId = data.split("|")[1];
    const approve = data.startsWith("mphotoyes|");
    await prisma.matchPhotoPermission
      .updateMany({ where: { ownerId: tgUserId, viewerId }, data: { status: approve ? "GRANTED" : "DENIED" } })
      .catch(() => null);
    if (approve) {
      const profile = await prisma.matchProfile.findUnique({ where: { userId: tgUserId } });
      if (profile?.photoFileId) {
        // If the viewer is still looking at this person's card, swap the
        // locked placeholder for the real photo right there.
        const viewer = await prisma.matchUser.findUnique({ where: { id: viewerId }, select: { pendingAction: true } });
        const vp = viewer?.pendingAction as PendingAction | null;
        let updated = false;
        if (vp?.mode === "search_browsing" && vp.current === tgUserId && vp.msgId) {
          const card = await buildSearchCard(tgUserId, viewerId);
          if (card) {
            updated = await bot.api
              .editMessageMedia(Number(viewerId), vp.msgId, { type: "photo", media: card.photo, caption: card.caption }, { reply_markup: card.kb })
              .then(() => true, () => false);
          }
        }
        await bot.api
          .sendMessage(Number(viewerId), updated ? `🔓 وافق «${profile.name}» على عرض صورته — ظهرت الآن على البطاقة.` : `🔓 وافق «${profile.name}» على عرض صورته.`)
          .catch(() => null);
        if (!updated) await bot.api.sendPhoto(Number(viewerId), profile.photoFileId).catch(() => null);
      }
    } else {
      await bot.api.sendMessage(Number(viewerId), "❌ لم يوافق صاحب الملف على مشاركة صورته.").catch(() => null);
    }
    await bot.api.answerCallbackQuery(cq.id, { text: approve ? "✅ تم السماح" : "تم الرفض" }).catch(() => null);
    return;
  }
  if (data.startsWith("maf|")) {
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    await handleAnonFilterCallback(bot, botRow, chatId, tgUserId, data, messageId);
    return;
  }
  if (data.startsWith("mexit|")) {
    const code = data.split("|")[1];
    const label = EXIT_REASON_LABELS[code] || EXIT_REASON_LABELS.other;
    if (pending?.mode === "random_chatting") {
      await endRandomChat(bot, tgUserId, pending.sessionId, pending.partnerId, "end", label);
    }
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data === "mcontact") {
    if (pending?.mode !== "random_chatting") {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    const r = await requestRandomChatContact(bot, tgUserId, { sessionId: pending.sessionId, partnerId: pending.partnerId });
    const answer = { ended: "انتهت هذه المحادثة.", not_offered: undefined, requested: "تم إرسال الطلب، بانتظار موافقة الطرف الآخر", already: "طلبك قيد الانتظار بالفعل", revealed: "✅ تم تبادل بيانات التواصل" }[r];
    await bot.api.answerCallbackQuery(cq.id, answer ? { text: answer } : undefined).catch(() => null);
    return;
  }
  if (data.startsWith("mblock|")) {
    const targetId = data.split("|")[1];
    const target = await prisma.matchProfile.findUnique({ where: { userId: targetId } });
    if (target) {
      await prisma.matchBlock.upsert({
        where: { blockerId_blockedId: { blockerId: tgUserId, blockedId: target.userId } },
        update: {},
        create: { blockerId: tgUserId, blockedId: target.userId },
      }).catch(() => null);
    }
    await bot.api.answerCallbackQuery(cq.id, { text: "⛔ تم الحظر" }).catch(() => null);
    if (pending?.mode === "search_browsing") {
      await advanceSearch(bot, chatId, tgUserId, pending, cq.message?.message_id);
    }
    return;
  }
  await bot.api.answerCallbackQuery(cq.id).catch(() => null);
}

// ---------------------------------------------------------------------
// Fake bots for random chat (owner spec, 2026-09-27)
// Simulated conversation partners to make the bot appear active.
// Disabled once 100+ active subscribers exist.
// ---------------------------------------------------------------------
const FAKE_BOT_ACTIVE_THRESHOLD = 100;

type FakeBotNode = {
  reply: string;
  next?: Record<string, number> | number;
  disconnect?: boolean;
  delayMs?: number;
};

type FakeBotScript = {
  greeting: string;
  greetingDelay?: number;
  nodes: FakeBotNode[];
};

const FAKE_BOT_SCRIPTS: FakeBotScript[] = [
  {
    greeting: "مرحبا",
    greetingDelay: 1500,
    nodes: [
      { reply: "نوعك؟", delayMs: 2000 },
      {
        reply: "",
        next: { "شب": 2, "شاب": 2, "ذكر": 2, "رجال": 2, "ولد": 2, _default: 3 },
      },
      { reply: "", disconnect: true, delayMs: 3000 },
      { reply: "من وين", delayMs: 2000 },
      { reply: "", disconnect: true, delayMs: 4000 },
    ],
  },
  {
    greeting: "شب وانت؟",
    greetingDelay: 1800,
    nodes: [
      { reply: "من وين", delayMs: 2500 },
      { reply: "", disconnect: true, delayMs: 3500 },
    ],
  },
  {
    greeting: "نوعك؟",
    greetingDelay: 1200,
    nodes: [
      { reply: "من وين", delayMs: 2000 },
      { reply: "عمرك", delayMs: 2500 },
      { reply: "", disconnect: true, delayMs: 3000 },
    ],
  },
  {
    greeting: "من وين",
    greetingDelay: 1500,
    nodes: [
      { reply: "نوعك", delayMs: 2000 },
      { reply: "عمرك كم", delayMs: 2500 },
      { reply: "", disconnect: true, delayMs: 3500 },
    ],
  },
  {
    greeting: "هلا",
    greetingDelay: 2000,
    nodes: [
      { reply: "من وين", delayMs: 2000 },
      { reply: "كم عمرك", delayMs: 2500 },
      { reply: "", disconnect: true, delayMs: 3000 },
    ],
  },
];

async function shouldUseFakeBots(botId: string): Promise<boolean> {
  const activeCount = await prisma.matchUser.count({
    where: {
      botId,
      lastActiveAt: { gt: new Date(Date.now() - 7 * 24 * 3600 * 1000) },
    },
  });
  return activeCount < FAKE_BOT_ACTIVE_THRESHOLD;
}

const FAKE_CHAT_TIMEOUT_MS = 5 * 60 * 1000;

// Serverless can't hold a 5-minute timer, so each bot message starts a chain
// of short self-calls to /api/internal/fake-chat-timeout keyed on that
// message's lastAt. A user reply writes a new lastAt, which makes the old
// chain stop and a new one start.
// Last few timer events (no user IDs), readable via the timeout route's GET.
export async function logFakeChatEvent(event: string) {
  try {
    const db = supabaseAdmin();
    const { data } = await db.from("bot_settings").select("value").eq("key", "fake_chat_debug").maybeSingle();
    const prev: string[] = Array.isArray((data as any)?.value) ? (data as any).value : [];
    const next = [...prev, `${new Date().toISOString().slice(11, 19)} ${event}`].slice(-40);
    await db.from("bot_settings").upsert({ key: "fake_chat_debug", value: next, updated_at: new Date().toISOString() });
  } catch {
    /* diagnostics only */
  }
}

// The Oracle VM calls /api/internal/fake-chat-sweep every minute. While that heartbeat is fresh the
// 280-second per-chat Vercel function is not started; when it goes stale the old per-chat chain resumes.
const SWEEPER_KEY = "fake_chat_sweeper_at";
const SWEEPER_FRESH_MS = 3 * 60 * 1000;
let sweeperCache = { at: 0, active: false };

async function fakeChatSweeperActive(): Promise<boolean> {
  if (Date.now() - sweeperCache.at < 30_000) return sweeperCache.active;
  let active = false;
  try {
    const { data } = await supabaseAdmin().from("bot_settings").select("value").eq("key", SWEEPER_KEY).maybeSingle();
    const t = Number((data as any)?.value);
    active = Number.isFinite(t) && Date.now() - t < SWEEPER_FRESH_MS;
  } catch {
    active = false;
  }
  sweeperCache = { at: Date.now(), active };
  return active;
}

// Ends every fake chat idle for 5+ minutes. Idempotent: expireFakeChatIfIdle re-checks lastAt itself.
export async function sweepFakeChats(): Promise<{ open: number; ended: number }> {
  await supabaseAdmin().from("bot_settings").upsert({ key: SWEEPER_KEY, value: Date.now(), updated_at: new Date().toISOString() });
  const rows = await prisma.matchUser.findMany({
    where: { pendingAction: { path: ["mode"], equals: "fake_chatting" } },
    select: { id: true, pendingAction: true },
  });
  let ended = 0;
  for (const r of rows) {
    const lastAt = (r.pendingAction as any)?.lastAt;
    if (typeof lastAt !== "number" || Date.now() - lastAt < FAKE_CHAT_TIMEOUT_MS) continue;
    const state = await expireFakeChatIfIdle(r.id, lastAt).catch(() => "stale" as const);
    if (state === "ended") ended++;
  }
  return { open: rows.length, ended };
}

export async function dispatchFakeChatCheck(userId: string, lastAt: number) {
  if (await fakeChatSweeperActive()) return;
  const user = await prisma.matchUser.findUnique({ where: { id: userId }, select: { botId: true } }).catch(() => null);
  if (!user?.botId) { await logFakeChatEvent("dispatch: no user/botId"); return; }
  const botRow = await prisma.bot.findUnique({ where: { id: user.botId }, select: { webhookSecret: true } }).catch(() => null);
  if (!botRow?.webhookSecret) { await logFakeChatEvent("dispatch: no webhookSecret"); return; }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);
  const res = await fetch(`${SITE_URL}/api/internal/fake-chat-timeout`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-fake-chat-secret": botRow.webhookSecret },
    body: JSON.stringify({ userId, lastAt }),
    signal: ac.signal,
  }).catch((e) => {
    console.error("[fake-chat] dispatch failed", e);
    return e as Error;
  });
  clearTimeout(timer);
  await logFakeChatEvent(
    res instanceof Response ? `dispatch -> ${res.status} (idle ${Math.round((Date.now() - lastAt) / 1000)}s)` : `dispatch error: ${String((res as Error)?.message || res).slice(0, 120)}`
  );
}

export async function isValidFakeChatSecret(userId: string, secret: string) {
  if (!secret) return false;
  const user = await prisma.matchUser.findUnique({ where: { id: userId }, select: { botId: true } }).catch(() => null);
  if (!user?.botId) return false;
  const botRow = await prisma.bot.findUnique({ where: { id: user.botId }, select: { webhookSecret: true } }).catch(() => null);
  return !!botRow?.webhookSecret && botRow.webhookSecret === secret;
}

// "stale": the user replied (or left) since this chain started — stop.
// "ended": 5 minutes passed with no reply — disconnected now.
// "waiting": not yet 5 minutes — keep chaining.
export async function expireFakeChatIfIdle(userId: string, lastAt: number): Promise<"stale" | "ended" | "waiting"> {
  const user = await prisma.matchUser.findUnique({ where: { id: userId } });
  const p = user?.pendingAction as any;
  if (!user || p?.mode !== "fake_chatting" || p.lastAt !== lastAt) return "stale";
  if (Date.now() - lastAt < FAKE_CHAT_TIMEOUT_MS) return "waiting";
  await setPending(userId, null);
  const botRow = await prisma.bot.findUnique({ where: { id: user.botId } });
  if (botRow) {
    await pingAnonSession(fakeSessionId(userId));
    await deliverToUser(new TelegramBot(botRow.token), userId, "⚠️ غادر المستخدم الآخر المحادثة.\nاضغط «🔀 مراسلة عشوائية» للبحث من جديد.", { reply_markup: mainMenu() });
  }
  return "ended";
}

/** Fake-partner chats live in the same history table under "fake:<uid>" so the app can render them. */
export const fakeSessionId = (uid: string) => `fake:${uid}`;
export const FAKE_SENDER = "partner";
async function fakeSay(bot: TelegramBot, tgUserId: string, text: string) {
  await recordAnonMessage(fakeSessionId(tgUserId), FAKE_SENDER, text);
  await pingAnonSession(fakeSessionId(tgUserId));
  await deliverToUser(bot, tgUserId, text);
}
async function endFakeChat(bot: TelegramBot, chatId: number, tgUserId: string) {
  await setPending(tgUserId, null);
  await pingAnonSession(fakeSessionId(tgUserId));
  await deliverToUser(bot, tgUserId, "⚠️ غادر المستخدم الآخر المحادثة.\nاضغط «🔀 مراسلة عشوائية» للبحث من جديد.", { reply_markup: mainMenu() });
}

export async function handleFakeBotReply(bot: TelegramBot, chatId: number, tgUserId: string, pending: { fakeBotId: number; step: number; lastAt: number }, userText: string) {
  if (Date.now() - pending.lastAt > FAKE_CHAT_TIMEOUT_MS) {
    await endFakeChat(bot, chatId, tgUserId);
    return;
  }

  const script = FAKE_BOT_SCRIPTS[pending.fakeBotId];
  if (!script) { await endFakeChat(bot, chatId, tgUserId); return; }

  const node = script.nodes[pending.step];
  if (!node) { await endFakeChat(bot, chatId, tgUserId); return; }

  if (node.reply) {
    await new Promise((r) => setTimeout(r, node.delayMs ?? 2000));
    await fakeSay(bot, tgUserId, node.reply);
  }

  if (node.disconnect) {
    await new Promise((r) => setTimeout(r, node.reply ? 1000 : (node.delayMs ?? 3000)));
    await endFakeChat(bot, chatId, tgUserId);
    return;
  }

  let nextStep: number;
  if (node.next) {
    if (typeof node.next === "number") {
      nextStep = node.next;
    } else {
      const lower = userText.trim().toLowerCase();
      let resolved: number | undefined;
      for (const [kw, target] of Object.entries(node.next)) {
        if (kw === "_default") continue;
        if (lower.includes(kw)) { resolved = target as number; break; }
      }
      nextStep = resolved ?? (node.next._default as number) ?? pending.step + 1;
    }
  } else {
    nextStep = pending.step + 1;
  }

  if (nextStep >= script.nodes.length) { await endFakeChat(bot, chatId, tgUserId); return; }

  const lastAt = Date.now();
  await setPending(tgUserId, { mode: "fake_chatting", fakeBotId: pending.fakeBotId, step: nextStep, lastAt });

  if (!node.reply && node.next) {
    await handleFakeBotReply(bot, chatId, tgUserId, { fakeBotId: pending.fakeBotId, step: nextStep, lastAt }, userText);
    return;
  }
  await dispatchFakeChatCheck(tgUserId, lastAt);
}

// ---------------------------------------------------------------------
// Random anonymous chat
// ---------------------------------------------------------------------
type AnonSelf = { profile: { gender: string; age: number; country: string } | null; filter: AnonFilter | null };
async function anonSelfSide(userId: string, filter: AnonFilter | null): Promise<AnonSelf> {
  const profile = await prisma.matchProfile.findUnique({ where: { userId }, select: { gender: true, age: true, country: true } });
  return { profile, filter };
}

// Returns waiting partners in queue order that pass the bot's rules (no
// mutual block, 24h cooldown) AND the mutual 🎛 anon-filter rule.
async function findWaitingPartners(botId: string, selfId: string, self: AnonSelf, skip: Set<string>) {
  const now = new Date();
  const waiting = await prisma.randomChatQueue.findMany({
    where: { botId, status: "WAITING", expiresAt: { gt: now }, userId: { not: selfId } },
    orderBy: { created_at: "asc" },
    take: 50,
    include: { user: { select: { vipUntil: true, profile: { select: { gender: true, age: true, country: true } } } } },
  });
  const filters = await getAnonFilterRows(waiting.map((w) => w.userId)).catch(() => new Map());
  const ids = waiting.map((w) => w.userId);
  // Batched: one query for blocks, one for recent sessions (was N+1).
  const [blocks, recent] = ids.length
    ? await Promise.all([
        prisma.matchBlock.findMany({ where: { OR: [{ blockerId: selfId, blockedId: { in: ids } }, { blockedId: selfId, blockerId: { in: ids } }] }, select: { blockerId: true, blockedId: true } }),
        prisma.randomChatSession.findMany({
          where: { OR: [{ user1Id: selfId, user2Id: { in: ids } }, { user2Id: selfId, user1Id: { in: ids } }], created_at: { gt: new Date(Date.now() - SKIP_COOLDOWN_HOURS * 3600 * 1000) } },
          select: { user1Id: true, user2Id: true },
        }),
      ])
    : [[], []];
  const excluded = new Set<string>([...blocks.flatMap((b) => [b.blockerId, b.blockedId]), ...recent.flatMap((r) => [r.user1Id, r.user2Id])]);
  excluded.delete(selfId);
  const out: typeof waiting = [];
  for (const w of waiting) {
    if (skip.has(w.id) || excluded.has(w.userId)) continue;
    const fr: any = filters.get(w.userId) ?? null;
    const other = { profile: w.user.profile, filter: activeFilterFor(fr, w.id, hasAnonFilters(w.user, fr?.paid_until)) };
    if (!anonPairOk(self, other)) continue;
    out.push(w);
  }
  return out;
}

async function getAvailableFakeBotIds(): Promise<number[]> {
  const busyUsers = await prisma.matchUser.findMany({
    where: { pendingAction: { path: ["mode"], equals: "fake_chatting" } },
    select: { pendingAction: true },
  });
  const busyIds = new Set(
    busyUsers.map((u) => (u.pendingAction as any)?.fakeBotId).filter((id: any) => typeof id === "number"),
  );
  return FAKE_BOT_SCRIPTS.map((_, i) => i).filter((id) => !busyIds.has(id));
}

async function matchWithRealPartner(bot: TelegramBot, chatId: number, botRow: BotRow, tgUserId: string, ownQueueId?: string, self?: AnonSelf) {
  const me = self ?? (await anonSelfSide(tgUserId, null));
  const tried = new Set<string>();
  for (let round = 0; round < 3; round++) {
    const candidates = await findWaitingPartners(botRow.id, tgUserId, me, tried);
    if (!candidates.length) return false;
    for (const partnerEntry of candidates) {
      tried.add(partnerEntry.id);
      // Own row first (if any): if someone already took us, stop here.
      if (ownQueueId) {
        const mine = await prisma.randomChatQueue.updateMany({ where: { id: ownQueueId, status: "WAITING" }, data: { status: "MATCHED" } });
        if (mine.count === 0) return false;
      }
      // Atomic claim of the partner's row: only one matcher can flip WAITING→MATCHED.
      const claimed = await prisma.randomChatQueue.updateMany({
        where: { id: partnerEntry.id, status: "WAITING", expiresAt: { gt: new Date() } },
        data: { status: "MATCHED" },
      });
      if (claimed.count === 0) {
        if (ownQueueId) await prisma.randomChatQueue.updateMany({ where: { id: ownQueueId, status: "MATCHED", sessionId: null }, data: { status: "WAITING" } });
        continue;
      }
      const session = await prisma.randomChatSession.create({ data: { user1Id: tgUserId, user2Id: partnerEntry.userId, botId: botRow.id } });
      await prisma.randomChatQueue.update({ where: { id: partnerEntry.id }, data: { sessionId: session.id } }).catch(() => null);
      if (ownQueueId) await prisma.randomChatQueue.update({ where: { id: ownQueueId }, data: { sessionId: session.id } }).catch(() => null);
      await setPending(tgUserId, { mode: "random_chatting", sessionId: session.id, partnerId: partnerEntry.userId });
      await setPending(partnerEntry.userId, { mode: "random_chatting", sessionId: session.id, partnerId: tgUserId });
      await deliverToUser(bot, tgUserId, "✅ تم الاتصال! ابدأ الدردشة الآن (مجهولة الهوية بالكامل).", { reply_markup: randomChatMenu() });
      await deliverToUser(bot, partnerEntry.userId, "✅ تم الاتصال! ابدأ الدردشة الآن (مجهولة الهوية بالكامل).", { reply_markup: randomChatMenu() });
      await pingAnonSession(session.id);
      return true;
    }
  }
  return false;
}

function anonWidenKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("🌐 ابحث هذه المرة بدون فلاتر", "maf|once").row().text("🎛 تعديل / توسيع الفلاتر", "maf|menu");
}
const anonTimeoutText = (f: AnonFilter | null) =>
  `⌛ لم نجد خلال دقيقة شريكاً يطابق فلاترك (${describeAnonFilter(f)}).\nلم نتجاهل فلاترك — يمكنك توسيعها، أو البحث هذه المرة بدون فلاتر، أو الضغط على «🔀 مراسلة عشوائية» للمحاولة مجدداً.`;

// Resolves which filter applies to this search and tells the user (never silently).
async function resolveAnonFilter(bot: TelegramBot, chatId: number, tgUserId: string, ignoreFilter: boolean): Promise<AnonFilter | null> {
  const row = await getAnonFilterRow(tgUserId).catch(() => null);
  // A previous filtered queue entry that expired unmatched → tell the user once.
  if (row?.active_queue_id) {
    const prev = await prisma.randomChatQueue.findUnique({ where: { id: row.active_queue_id } }).catch(() => null);
    if (prev && prev.status === "WAITING" && prev.expiresAt <= new Date() && (await markAnonNotified(tgUserId, prev.id).catch(() => false))) {
      await bot.api.sendMessage(chatId, anonTimeoutText(row.filter), { reply_markup: anonWidenKeyboard() }).catch(() => null);
    }
  }
  const f = row?.filter ? sanitizeAnonFilter(row.filter) : null;
  if (!f || anonFilterIsEmpty(f) || ignoreFilter) return null;
  const u = await prisma.matchUser.findUnique({ where: { id: tgUserId }, select: { vipUntil: true } });
  if (!hasAnonFilters({ vipUntil: u?.vipUntil ?? null }, row?.paid_until)) {
    await bot.api
      .sendMessage(chatId, `ℹ️ انتهى اشتراك «🎛 فلاتر الدردشة العشوائية»، لذا سيكون هذا البحث بدون فلاتر (لم يُخصم شيء).\nللتجديد: $${PRICE_ANON_FILTERS} لمدة ${ANON_FILTERS_DAYS} يوماً.`, {
        reply_markup: new InlineKeyboard().text(`🎛 تجديد ($${PRICE_ANON_FILTERS})`, "maf|buy"),
      })
      .catch(() => null);
    return null;
  }
  return f;
}

export async function startRandomChat(bot: TelegramBot, chatId: number, botRow: BotRow, tgUserId: string, opts: { ignoreFilter?: boolean; quiet?: boolean } = {}) {
  const filter = await resolveAnonFilter(bot, chatId, tgUserId, !!opts.ignoreFilter);
  const self = await anonSelfSide(tgUserId, filter);
  await prisma.randomChatQueue.updateMany({ where: { userId: tgUserId, status: "WAITING" }, data: { status: "CANCELLED" } });
  // Snapshot the filter onto THIS queue row id before the row exists, so no
  // matcher can ever see the row without its filter.
  const queueId = randomUUID();
  await setAnonActiveQueue(tgUserId, filter ? queueId : null).catch(() => null);
  if (await matchWithRealPartner(bot, chatId, botRow, tgUserId, undefined, self)) return;

  const queueEntry = await prisma.randomChatQueue.create({
    data: { id: queueId, userId: tgUserId, botId: botRow.id, status: "WAITING", expiresAt: new Date(Date.now() + RANDOM_CHAT_WINDOW_SECONDS * 1000) },
  });
  await setPending(tgUserId, { mode: "random_waiting" });
  if (filter) {
    await bot.api
      .sendMessage(chatId, `🎛 البحث بفلاترك: ${describeAnonFilter(filter)}\nننتظر شريكاً يطابقها (ويطابق هو فلاتره عليك) لمدة دقيقة.`, { reply_markup: anonWidenKeyboard() })
      .catch(() => null);
  }
  // Animation (~6s), the second pairing attempt and the fake-partner greeting
  // run AFTER the webhook response (next/server after()), so Telegram's request
  // returns fast. Same steps, same order; the app path (quiet) runs inline.
  const rest = async () => {
  if (!opts.quiet) await animateSearchingMessage(bot, chatId);
  // App path: no animation, but the SAME waiting window before the second pairing
  // attempt / fake fallback, so two app users searching together meet each other.
  else await new Promise((r) => setTimeout(r, appSearchWaitMs()));

  const current = await prisma.matchUser.findUnique({ where: { id: tgUserId }, select: { pendingAction: true } });
  if ((current?.pendingAction as any)?.mode === "random_chatting") return;

  if (await matchWithRealPartner(bot, chatId, botRow, tgUserId, queueEntry.id, self)) return;

  // Filtered users are never handed a scripted fake partner (it can't satisfy a filter).
  if (filter) return;
  if (await shouldUseFakeBots(botRow.id)) {
    const availableIds = await getAvailableFakeBotIds();
    if (availableIds.length > 0) {
      const fakeBotId = availableIds[Math.floor(Math.random() * availableIds.length)];
      const script = FAKE_BOT_SCRIPTS[fakeBotId];
      await prisma.randomChatQueue.update({ where: { id: queueEntry.id }, data: { status: "MATCHED" } }).catch(() => null);
      await clearAnonHistory(fakeSessionId(tgUserId));
      await setPending(tgUserId, { mode: "fake_chatting", fakeBotId, step: 0, lastAt: Date.now() });
      await deliverToUser(bot, tgUserId, "✅ تم الاتصال! ابدأ الدردشة الآن (مجهولة الهوية بالكامل).", { reply_markup: randomChatMenu() });
      await pingAnonSession(fakeSessionId(tgUserId));
      await new Promise((r) => setTimeout(r, script.greetingDelay ?? 1500));
      await fakeSay(bot, tgUserId, script.greeting);
      // Restart the 5-minute clock from the greeting itself, unless the user
      // already replied during the greeting delay (that reply owns the clock).
      const now = await prisma.matchUser.findUnique({ where: { id: tgUserId }, select: { pendingAction: true } });
      const p = now?.pendingAction as any;
      if (p?.mode === "fake_chatting" && p.fakeBotId === fakeBotId && p.step === 0) {
        const lastAt = Date.now();
        await setPending(tgUserId, { mode: "fake_chatting", fakeBotId, step: 0, lastAt });
        await dispatchFakeChatCheck(tgUserId, lastAt);
      } else {
        await logFakeChatEvent(`greeting: no dispatch (mode=${p?.mode} step=${p?.step})`);
      }
      return;
    }
  }
  };
  // App path too: the app polls for the result, so its request returns at once.
  runAfterResponse(rest);
}

/** Same length as the bot's search animation (frames × 650ms + final 650ms). */
export function appSearchWaitMs(): number {
  return SEARCH_BAR_FRAMES.length * 650;
}

/** Schedule work after the HTTP response when inside a request; otherwise run now. */
function runAfterResponse(fn: () => Promise<void>): void | Promise<void> {
  try {
    after(() => fn().catch((e) => console.error("[match after]", e)));
  } catch {
    return fn();
  }
}

// Brief "live searching" animation (owner request, 2026-09-05): a single
// static message reads as frozen/empty next to other bots whose search
// card visibly animates. The search itself is already real — the
// RandomChatQueue row above was just created — this only adds visual
// feedback that it's actively happening; it never fakes a search that
// isn't real. Kept to ~4s of edits (Telegram's editMessageText, not a
// GIF — text can't literally spin) so the whole request stays well
// inside the telegram webhook route's execution budget (see
// `maxDuration` in src/app/api/telegram/[botId]/route.ts) alongside the
// DB work already happening in this same request.
//
// Uses a moving block on a fixed-width progress bar (radar-style, back
// and forth) rather than a growing dot trail: an earlier version just
// changed the dot count on an otherwise-identical line, and a first
// round of owner testing (2026-09-05) read that as the line "flickering"
// rather than an intentional animation — easy to mistake for a rendering
// glitch. A bar with a block visibly sliding position reads unambiguously
// as a loading indicator instead.
const SEARCH_BAR_FRAMES = ["▓░░░░░", "░▓░░░░", "░░▓░░░", "░░░▓░░", "░░░░▓░", "░░░░░▓", "░░░▓░░", "░▓░░░░"];

async function animateSearchingMessage(bot: TelegramBot, chatId: number) {
  // No reply_markup on this message, on purpose: Telegram's Bot API
  // rejects editMessageText with "400: Bad Request: message can't be
  // edited" on ANY message that was sent carrying a ReplyKeyboardMarkup
  // (the persistent bottom keyboard) — confirmed via production logs,
  // 2026-09-05, where every single edit below failed with exactly that
  // error. Inline keyboards (see the working carousel in adBotLogic.ts)
  // don't have this restriction; reply keyboards do. We don't lose the
  // retry button by dropping it here: the visitor can only reach this
  // function by having just pressed "🔀 مراسلة عشوائية" on whatever
  // keyboard was already showing (mainMenu, or this same waiting keyboard
  // from an earlier press) — that keyboard stays untouched and the button
  // is still right there.
  const label = "🔍 جاري البحث عن شريك للمحادثة...";
  let msg;
  try {
    msg = await bot.api.sendMessage(chatId, `${label}\n${SEARCH_BAR_FRAMES[0]}`);
  } catch (e) {
    console.error("[randomChat] initial sendMessage FAILED", e);
    return;
  }
  for (const bar of SEARCH_BAR_FRAMES.slice(1)) {
    await new Promise((resolve) => setTimeout(resolve, 650));
    await bot.api
      .editMessageText(chatId, msg.message_id, `${label}\n${bar}`)
      .catch((e) => console.error("[randomChat] edit FAILED", e));
  }
  await new Promise((resolve) => setTimeout(resolve, 650));
  await bot.api
    .editMessageText(
      chatId,
      msg.message_id,
      "🔍 يتم البحث الآن عن شريك للمحادثة... إن لم يُعثر على أحد خلال دقيقة واحدة، اضغط الزر مجدداً للتحقق."
    )
    .catch((e) => console.error("[randomChat] final edit FAILED", e));
}


// ---- 🎛 فلاتر الدردشة العشوائية (paid, $2/30d, included in VIP) --------------------------------
const AGE_PRESETS: [string, number | undefined, number | undefined][] = [["أي عمر", undefined, undefined], ["18–25", 18, 25], ["26–35", 26, 35], ["36–45", 36, 45], ["46+", 46, undefined]];
async function anonFilterKeyboard(tgUserId: string, f: AnonFilter): Promise<InlineKeyboard> {
  const mark = (on: boolean, t: string) => (on ? `✅ ${t}` : t);
  const kb = new InlineKeyboard()
    .text(mark(!f.gender, "الجنس: الكل"), "maf|g|any").text(mark(f.gender === "MALE", "ذكر"), "maf|g|MALE").text(mark(f.gender === "FEMALE", "أنثى"), "maf|g|FEMALE").row();
  const me = await prisma.matchProfile.findUnique({ where: { userId: tgUserId }, select: { country: true } });
  kb.text(mark(!f.country, "أي دولة"), "maf|c|any");
  if (me?.country) kb.text(mark(f.country === me.country, `دولتي (${me.country})`), "maf|c|mine");
  kb.row();
  AGE_PRESETS.forEach(([label, a, b], i) => {
    kb.text(mark(f.ageMin === a && f.ageMax === b, label), `maf|a|${i}`);
    if (i === 2) kb.row();
  });
  return kb.row().text("🔀 ابدأ البحث بهذه الفلاتر", "maf|go");
}
export async function showAnonFiltersMenu(bot: TelegramBot, chatId: number, tgUserId: string) {
  const row = await getAnonFilterRow(tgUserId).catch(() => null);
  const u = await prisma.matchUser.findUnique({ where: { id: tgUserId }, select: { vipUntil: true } });
  const owned = hasAnonFilters({ vipUntil: u?.vipUntil ?? null }, row?.paid_until);
  if (!owned) {
    await bot.api.sendMessage(
      chatId,
      `🎛 فلاتر الدردشة العشوائية\n\nاختر من تُطابَق معه في «🔀 مراسلة عشوائية»: الجنس، الدولة، والفئة العمرية. تتم المطابقة فقط مع من يحقق فلاترك (وإن كان لديه فلاتر فيجب أن تحققها أنت أيضاً).\n\nالسعر: $${PRICE_ANON_FILTERS} لمدة ${ANON_FILTERS_DAYS} يوماً — ومشمولة مجاناً في «👑 العضوية الذهبية».\nلا تجديد تلقائي.`,
      { reply_markup: new InlineKeyboard().text(`✅ تفعيل ($${PRICE_ANON_FILTERS} / ${ANON_FILTERS_DAYS} يوماً)`, "maf|buy") }
    ).catch(() => null);
    return;
  }
  const f = sanitizeAnonFilter(row?.filter ?? {});
  const until = u?.vipUntil && u.vipUntil > new Date() ? "ضمن العضوية الذهبية" : `حتى ${row?.paid_until?.toLocaleDateString("ar")}`;
  await bot.api
    .sendMessage(chatId, `🎛 فلاتر الدردشة العشوائية (${until})\nالحالية: ${describeAnonFilter(f)}\n\nاختر ثم اضغط «🔀 ابدأ البحث»:`, { reply_markup: await anonFilterKeyboard(tgUserId, f) })
    .catch(() => null);
}
async function handleAnonFilterCallback(bot: TelegramBot, botRow: BotRow, chatId: number, tgUserId: string, data: string, messageId?: number) {
  const [, kind, val] = data.split("|");
  if (kind === "menu") return showAnonFiltersMenu(bot, chatId, tgUserId);
  if (kind === "once") return startRandomChat(bot, chatId, botRow, tgUserId, { ignoreFilter: true });
  if (kind === "go") return startRandomChat(bot, chatId, botRow, tgUserId);
  if (kind === "buy") {
    const r = await purchaseAnonFilters(tgUserId);
    if (!r.ok) {
      if (r.reason === "insufficient") await bot.api.sendMessage(chatId, insufficientBalanceText(tgUserId, r.needed, r.balance), { reply_markup: upgradesMenu() }).catch(() => null);
      return;
    }
    await bot.api.sendMessage(chatId, r.viaVip ? "👑 الفلاتر مشمولة في عضويتك الذهبية — لم يُخصم شيء." : `✅ تم تفعيل فلاتر الدردشة العشوائية حتى ${r.until?.toLocaleDateString("ar")} (خُصم $${PRICE_ANON_FILTERS}).`).catch(() => null);
    return showAnonFiltersMenu(bot, chatId, tgUserId);
  }
  const row = await getAnonFilterRow(tgUserId).catch(() => null);
  const u = await prisma.matchUser.findUnique({ where: { id: tgUserId }, select: { vipUntil: true } });
  if (!hasAnonFilters({ vipUntil: u?.vipUntil ?? null }, row?.paid_until)) return showAnonFiltersMenu(bot, chatId, tgUserId);
  const f = sanitizeAnonFilter(row?.filter ?? {});
  if (kind === "g") { if (val === "any") delete f.gender; else f.gender = val as any; }
  if (kind === "c") {
    if (val === "any") delete f.country;
    else { const me = await prisma.matchProfile.findUnique({ where: { userId: tgUserId }, select: { country: true } }); if (me?.country) f.country = me.country; }
  }
  if (kind === "a") {
    const p = AGE_PRESETS[Number(val)] ?? AGE_PRESETS[0];
    delete f.ageMin; delete f.ageMax;
    if (p[1] != null) f.ageMin = p[1];
    if (p[2] != null) f.ageMax = p[2];
  }
  await setAnonFilterValue(tgUserId, f);
  if (messageId) {
    await bot.api.editMessageReplyMarkup(chatId, messageId, { reply_markup: await anonFilterKeyboard(tgUserId, f) }).catch(() => null);
  }
}

export const ANON_IDLE_MINUTES = 30;
/** Every minute (fake-chat sweeper): end real random chats idle for 30 min. */
export async function sweepIdleRandomSessions(): Promise<number> {
  const idle = await idleRandomSessions(ANON_IDLE_MINUTES);
  const tokens = new Map<string, string>();
  let n = 0;
  for (const sess of idle) {
    const ended = await prisma.randomChatSession.updateMany({ where: { id: sess.id, status: "ACTIVE" }, data: { status: "ENDED", ended_at: new Date() } });
    if (ended.count === 0) continue;
    let token = tokens.get(sess.botId);
    if (!token) { const b = await prisma.bot.findUnique({ where: { id: sess.botId } }); if (b) { token = b.token; tokens.set(sess.botId, token); } }
    for (const uid of [sess.user1Id, sess.user2Id]) {
      const u = await prisma.matchUser.findUnique({ where: { id: uid }, select: { pendingAction: true } });
      if ((u?.pendingAction as any)?.sessionId === sess.id) await setPending(uid, null);
      if (token) await new TelegramBot(token).api.sendMessage(Number(uid), `⌛ انتهت المحادثة العشوائية تلقائياً بعد ${ANON_IDLE_MINUTES} دقيقة دون رسائل.`, { reply_markup: mainMenu() }).catch(() => null);
    }
    await pingAnonSession(sess.id);
    n++;
  }
  return n;
}

/** Every minute (fake-chat sweeper): filtered queue entries that expired unmatched get a "widen?" notice. */
export async function sweepAnonFilterTimeouts(): Promise<number> {
  const expired = await prisma.randomChatQueue.findMany({
    where: { status: "WAITING", expiresAt: { lte: new Date(), gt: new Date(Date.now() - 15 * 60_000) } },
    take: 100,
  });
  if (!expired.length) return 0;
  const rows = await getAnonFilterRows(expired.map((q) => q.userId));
  const tokens = new Map<string, string>();
  let n = 0;
  for (const q of expired) {
    const fr: any = rows.get(q.userId) ?? null;
    const pending = await prisma.matchUser.findUnique({ where: { id: q.userId }, select: { pendingAction: true, vipUntil: true } });
    const f = activeFilterFor(fr, q.id, !!pending && hasAnonFilters(pending, fr?.paid_until));
    if (!f) continue;
    if ((pending?.pendingAction as any)?.mode !== "random_waiting") continue;
    if (!(await markAnonNotified(q.userId, q.id))) continue;
    let token = tokens.get(q.botId);
    if (!token) { const b = await prisma.bot.findUnique({ where: { id: q.botId } }); if (!b) continue; token = b.token; tokens.set(q.botId, token); }
    await new TelegramBot(token).api.sendMessage(Number(q.userId), anonTimeoutText(f), { reply_markup: anonWidenKeyboard() }).catch(() => null);
    n++;
  }
  return n;
}

/** The bot's random-chat relay (text only), shared verbatim with the Mini App. */
export async function relayRandomChatText(bot: TelegramBot, chatId: number, tgUserId: string, pending: { sessionId: string; partnerId: string }, text: string): Promise<"sent" | "banned" | "contact"> {
    if (containsContactInfo(text)) {
      await bot.api.sendMessage(chatId, CONTACT_BLOCKED_TEXT).catch(() => null);
      return "contact";
    }
    if (containsMatchBannedWords(text)) {
      await bot.api.sendMessage(chatId, "⚠️ هذه الرسالة تحتوي على محتوى غير مسموح به ولم يتم إرسالها.").catch(() => null);
      return "banned";
    }
    await deliverToUser(bot, pending.partnerId, text);
    // Mini App chat window reads this history (additive, never throws).
    await recordAnonMessage(pending.sessionId, tgUserId, text);
    await pingAnonSession(pending.sessionId);

    const updatedSession = await prisma.randomChatSession
      .update({ where: { id: pending.sessionId }, data: { messageCount: { increment: 1 } } })
      .catch(() => null);
    if (updatedSession && !updatedSession.contactOfferSent && updatedSession.messageCount >= CONTACT_REQUEST_THRESHOLD) {
      await prisma.randomChatSession.update({ where: { id: pending.sessionId }, data: { contactOfferSent: true } }).catch(() => null);
      const offerKb = new InlineKeyboard().text("📇 طلب تبادل التواصل الرسمي", "mcontact");
      const offerText = "💬 المحادثة مستمرة بشكل جيد. عند الرغبة، يمكنكما طلب تبادل بيانات التواصل الرسمي لمتابعة الأمر بجدية أكبر:";
      await deliverToUser(bot, tgUserId, offerText, { reply_markup: offerKb });
      await deliverToUser(bot, pending.partnerId, offerText, { reply_markup: offerKb });
    }
    return "sent";
}

export const AUTO_MUTE_DISTINCT_REPORTERS = 3;
const AUTO_MUTE_DAYS = 30; // "until the admin reviews" — admin's ignore/unban lifts it.
/**
 * Every user report goes through here (bot + app): shared rate limit, the
 * bot's admin alert exactly as before, then auto-mute once 3 DIFFERENT users
 * have PENDING reports against the same person (admin notified to review).
 */
export async function fileMatchReport(bot: TelegramBot, reporterId: string, targetId: string, source: "SEARCH" | "RANDOM_CHAT", adminText: string, reason?: string): Promise<"ok" | "limited"> {
  if (!(await pgRateLimit(`report:${reporterId}`, 10, 3600))) return "limited";
  await prisma.matchReport.create({ data: { reporterId, targetId, source, ...(reason ? { reason } : {}) } }).catch(() => null);
  if (SUPER_ADMIN_ID) await bot.api.sendMessage(Number(SUPER_ADMIN_ID), adminText).catch(() => null);
  const distinct = await prisma.matchReport.findMany({ where: { targetId, status: "PENDING" }, distinct: ["reporterId"], select: { reporterId: true } });
  if (distinct.length >= AUTO_MUTE_DISTINCT_REPORTERS) {
    const until = new Date(Date.now() + AUTO_MUTE_DAYS * 86400_000);
    const muted = await prisma.matchUser.updateMany({ where: { id: targetId, isBanned: false, OR: [{ mutedUntil: null }, { mutedUntil: { lt: new Date() } }] }, data: { mutedUntil: until } });
    if (muted.count === 1) {
      await auditAdmin("system", "auto_mute", targetId, `${distinct.length} distinct reporters`);
      if (SUPER_ADMIN_ID) {
        await bot.api.sendMessage(Number(SUPER_ADMIN_ID), `🔇 كتم تلقائي للمستخدم ${targetId} بعد بلاغات من ${distinct.length} مستخدمين مختلفين.\nراجع البلاغات؛ إن لم تثبت المخالفة ارفع الكتم من «🔓 رفع حظر/كتم».`).catch(() => null);
      }
    }
  }
  return "ok";
}

/** 🚩 إبلاغ during a random chat (bot button and Mini App). */
export async function reportRandomChat(bot: TelegramBot, chatId: number, tgUserId: string, partnerId: string) {
  await fileMatchReport(bot, tgUserId, partnerId, "RANDOM_CHAT", `🚩 بلاغ من محادثة عشوائية — المُبلِّغ ${tgUserId} ضد ${partnerId}.\nراجعه من «🚩 بلاغات الدردشة العشوائية».`);
  await bot.api.sendMessage(chatId, "🚩 تم إرسال بلاغك.").catch(() => null);
}

/** «📇 طلب تبادل التواصل الرسمي» — same consent flow for bot and app. Only after the 15-message offer. */
export async function requestRandomChatContact(bot: TelegramBot, tgUserId: string, pending: { sessionId: string; partnerId: string }): Promise<"ended" | "not_offered" | "requested" | "already" | "revealed"> {
  const session = await prisma.randomChatSession.findUnique({ where: { id: pending.sessionId } });
  if (!session || session.status !== "ACTIVE") return "ended";
  if (!session.contactOfferSent) return "not_offered";
  if (!session.contactRequestedBy) {
    // Atomic: only one side can become "the requester"; if both tap at once the
    // loser falls through to the consent branch below and the exchange happens.
    const claimed = await prisma.randomChatSession.updateMany({ where: { id: session.id, contactRequestedBy: null }, data: { contactRequestedBy: tgUserId } });
    if (claimed.count === 1) {
      await deliverToUser(bot, pending.partnerId, "📇 يرغب الطرف الآخر بتبادل بيانات التواصل الرسمي معك. إن وافقت، اضغط الزر:", {
        reply_markup: new InlineKeyboard().text("✅ أوافق على التبادل", "mcontact"),
      });
      await pingAnonSession(pending.sessionId);
      return "requested";
    }
    const fresh = await prisma.randomChatSession.findUnique({ where: { id: session.id }, select: { contactRequestedBy: true } });
    if (!fresh?.contactRequestedBy || fresh.contactRequestedBy === tgUserId) return "already";
  } else if (session.contactRequestedBy === tgUserId) return "already";
  await revealContacts(bot, tgUserId, pending.partnerId);
  // Athar «gift the date of your first chat» suggestion (flag-gated; nothing visible in the bot).
  if (atharEnabled()) await recordMoment([tgUserId, pending.partnerId], "contact", session.created_at).catch(() => null);
  return "revealed";
}

// Respectful exit system (owner spec, 2026-09-05) — ending a random chat
// used to just vanish on the other side with a bare "انتهت المحادثة."
// Now the leaving side picks a short polite reason first (see
// exitReasonKeyboard below) and the partner gets a proper closing message
// instead of an abrupt cutoff. The reason is optional (a plain "⛔ حظر" or
// the global back-button escape hatch still end instantly without one).
export const EXIT_REASON_LABELS: Record<string, string> = {
  no_match: "عدم توافق في الشروط",
  satisfied: "اكتفيت من المحادثة، شكراً",
  no_time: "لا يوجد وقت كافٍ حالياً",
  other: "إنهاء المحادثة",
};

function exitReasonKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🙏 عدم توافق بالشروط", "mexit|no_match")
    .row()
    .text("✅ اكتفيت، شكراً", "mexit|satisfied")
    .row()
    .text("⏱ لا وقت كافٍ الآن", "mexit|no_time")
    .row()
    .text("➡️ إنهاء بدون سبب محدد", "mexit|other");
}

// Formal contact request (owner spec, 2026-09-05) — once both sides
// explicitly agree (see the "mcontact" callback), reveal each side's own
// declared contact info from their MatchProfile, same contactMethod/
// contactValue already used on the search-result card's "💬 رسالة"
// button. Random chat has no MatchProfile requirement, so either side may
// not have one — handled gracefully rather than erroring.
export async function revealContacts(bot: TelegramBot, userA: string, userB: string) {
  const [profileA, profileB] = await Promise.all([
    prisma.matchProfile.findUnique({ where: { userId: userA } }),
    prisma.matchProfile.findUnique({ where: { userId: userB } }),
  ]);
  const contactLine = (p: MatchProfile | null) =>
    p
      ? `📇 بيانات التواصل: ${p.contactMethod === "TELEGRAM" ? "@" + p.contactValue.replace(/^@/, "") : p.contactValue}`
      : "لم يُكمل الطرف الآخر ملفاً شخصياً يحوي بيانات تواصل — يمكنكما تبادلها يدوياً إن رغبتما.";
  await bot.api.sendMessage(Number(userA), `✅ تم الاتفاق على تبادل التواصل الرسمي.\n${contactLine(profileB)}`).catch(() => null);
  await bot.api.sendMessage(Number(userB), `✅ تم الاتفاق على تبادل التواصل الرسمي.\n${contactLine(profileA)}`).catch(() => null);
}

export async function endRandomChat(bot: TelegramBot, tgUserId: string, sessionId: string, partnerId: string, reason: "end" | "block", exitReasonLabel?: string) {
  await prisma.randomChatSession.update({ where: { id: sessionId }, data: { status: "ENDED", ended_at: new Date() } }).catch(() => null);
  if (reason === "block") {
    await prisma.matchBlock.upsert({
      where: { blockerId_blockedId: { blockerId: tgUserId, blockedId: partnerId } },
      update: {},
      create: { blockerId: tgUserId, blockedId: partnerId },
    }).catch(() => null);
  }
  await setPending(tgUserId, null);
  await setPending(partnerId, null);
  const partnerText =
    reason === "block" || !exitReasonLabel
      ? "انتهت المحادثة."
      : `🙏 أنهى الطرف الآخر المحادثة (السبب: ${exitReasonLabel}). شكراً لوقتك، ونتمنى لك التوفيق في إيجاد شريك مناسب.`;
  await pingAnonSession(sessionId);
  await deliverToUser(bot, tgUserId, "انتهت المحادثة.", { reply_markup: mainMenu() });
  await deliverToUser(bot, partnerId, partnerText, { reply_markup: mainMenu() });
}

// ---------------------------------------------------------------------
// SUPER_ADMIN moderation (text commands, same convention as adBotLogic)
// ---------------------------------------------------------------------
// Referral reward (owner spec, 2026-09-05) — 24h free Boost for the referrer,
// granted exactly once per referred person, only when the referred profile goes
// live (never on rejection).
export async function grantReferralReward(bot: TelegramBot, profileUserId: string) {
  const referredUser = await prisma.matchUser.findUnique({ where: { id: profileUserId } });
  if (referredUser?.referredBy && !referredUser.referralRewardGranted) {
    await prisma.matchUser.update({ where: { id: profileUserId }, data: { referralRewardGranted: true } }).catch(() => null);
    const boostUntil = new Date(Date.now() + 24 * 3600 * 1000);
    await prisma.matchProfile
      .update({ where: { userId: referredUser.referredBy }, data: { boostedUntil: boostUntil } })
      .catch(() => null);
    await bot.api
      .sendMessage(Number(referredUser.referredBy), "🎁 اعتُمد ملف صديق دعوته! حصلت على رفع مجاني لملفك لمدة 24 ساعة.")
      .catch(() => null);
  }
}

async function applyProfileDecision(bot: TelegramBot, adminChatId: number, profile: MatchProfile, approve: boolean, say?: (t: string) => Promise<unknown>) {
  await prisma.matchProfile.update({ where: { userId: profile.userId }, data: { status: approve ? "APPROVED" : "REJECTED" } });
  await auditAdmin(String(adminChatId), approve ? "profile_approve" : "profile_reject", profile.userId, null, adminVia);
  const note = approve ? `✅ تم اعتماد ملف ${profile.name}.` : `❌ تم رفض ملف ${profile.name}.`;
  if (say) await say(note); else await bot.api.sendMessage(adminChatId, note);
  await bot.api
    .sendMessage(
      Number(profile.userId),
      approve ? "✅ تم اعتماد ملفك الشخصي! يمكنك الآن استخدام «🔍 البحث عن شريك»." : "❌ لم تتم الموافقة على ملفك الشخصي. راجع بياناتك من «👤 ملفي الشخصي» وحاول مجدداً."
    )
    .catch(() => null);

  if (approve) await grantReferralReward(bot, profile.userId);
  // 🔔 Mini App feed (additive; never affects the bot flow).
  await pushNotification(profile.userId, approve ? "profile_ok" : "profile_rejected", approve ? "✅ تم اعتماد ملفك — أنت الآن ظاهر في البطاقات" : "❌ لم يُعتمد ملفك — راجع بياناتك من «ملفي»").catch(() => null);
}

async function decideProfile(bot: TelegramBot, chatId: number, idSuffix: string, approve: boolean) {
  const candidates = await prisma.matchProfile.findMany({ where: { status: approve ? { in: ["PENDING", "APPROVED", "REJECTED"] } : { in: ["PENDING", "APPROVED"] } }, take: 500 });
  const profile = candidates.find((p) => shortId(p.userId) === idSuffix);
  if (!profile) {
    await bot.api.sendMessage(chatId, "الملف غير موجود أو رُوجع مسبقاً.");
    return;
  }
  await decideProfileByUserId(bot, chatId, profile.userId, approve);
}

/**
 * opts.quiet (✅/❌ buttons): no extra admin chat message — the short result is
 * returned for the callback toast. Every decision (button, text command, app
 * dashboard) removes the stored review cards for that profile.
 */
export async function decideProfileByUserId(bot: TelegramBot, chatId: number, userId: string, approve: boolean, opts: { quiet?: boolean } = {}): Promise<string> {
  let result = "";
  const say = async (t: string) => { result = t; if (!opts.quiet) await bot.api.sendMessage(chatId, t); };
  const profile = await prisma.matchProfile.findUnique({ where: { userId } });
  // Profiles now go live automatically, so the admin must still be able to
  // reject an already-APPROVED profile afterwards.
  if (!profile || (profile.status === "REJECTED" && !approve)) {
    await say("الملف غير موجود أو رُوجع مسبقاً.");
    await clearReviewCards(bot, userId, profile ? "❌ مرفوض مسبقاً" : "").catch(() => null);
    return result;
  }
  // Edited/old profiles are auto-live (APPROVED) — the admin's ✅ on the
  // «ملف جديد/معدّل» notice is a confirmation, not an error.
  if (approve && profile.status === "APPROVED") {
    await confirmApprovedProfile(bot, chatId, profile, say);
  } else {
    await applyProfileDecision(bot, chatId, profile, approve, say);
  }
  await clearReviewCards(bot, userId, approve ? "✅ تم القبول" : "❌ تم الرفض").catch(() => null);
  return result;
}

// ---- admin review cards: stored so a decision removes every card for that profile ----
async function storeReviewCard(userId: string, chatId: number, messageIds: number[]) {
  await ensureMatchAppTables();
  for (const m of messageIds) await prisma.$executeRaw`INSERT INTO match_review_cards (user_id, chat_id, message_id) VALUES (${userId}, ${String(chatId)}, ${m}) ON CONFLICT DO NOTHING`;
}
/** Delete (fallback: strip buttons + mark result) one admin card. */
export async function removeReviewMessage(bot: TelegramBot, chatId: number | string, messageId: number, resultLabel: string, isMedia = false) {
  const deleted = await bot.api.deleteMessage(Number(chatId), messageId).then(() => true).catch(() => false);
  if (deleted) return "deleted" as const;
  // e.g. older than 48h: Telegram refuses to delete → remove the buttons and show the result instead.
  await bot.api.editMessageReplyMarkup(Number(chatId), messageId, { reply_markup: new InlineKeyboard() }).catch(() => null);
  if (resultLabel) {
    const edit = isMedia
      ? bot.api.editMessageCaption(Number(chatId), messageId, { caption: resultLabel })
      : bot.api.editMessageText(Number(chatId), messageId, resultLabel);
    await edit.catch(() => null);
  }
  return "edited" as const;
}
export async function clearReviewCards(bot: TelegramBot, userId: string, resultLabel: string) {
  await ensureMatchAppTables();
  const rows = await prisma.$queryRaw<{ chat_id: string; message_id: number }[]>`DELETE FROM match_review_cards WHERE user_id = ${userId} RETURNING chat_id, message_id`;
  for (const r of rows) await removeReviewMessage(bot, r.chat_id, Number(r.message_id), resultLabel);
}

async function confirmApprovedProfile(bot: TelegramBot, adminChatId: number, profile: MatchProfile, say?: (t: string) => Promise<unknown>) {
  const out = say ?? ((t: string) => bot.api.sendMessage(adminChatId, t));
  if (profile.isHidden) {
    await out(`✅ ملف ${profile.name} معتمد، لكن صاحبه أخفاه مؤقتاً بنفسه (لن يظهر حتى يعيد إظهاره).`);
  } else {
    await out(`✅ تم تأكيد ملف ${profile.name} — معتمد وظاهر في البحث وبطاقات التطبيق.`);
  }
  await auditAdmin(String(adminChatId), "profile_confirm", profile.userId, null, adminVia).catch(() => null);
}

export async function adminStatsData(botId: string) {
  const onlineSince = new Date(Date.now() - ONLINE_THRESHOLD_MINUTES * 60000);
  // The SUPER_ADMIN also gets a MatchUser row (purely to store their own
  // pendingAction state for the broadcast/lookup/unban flows below) — it
  // must never count as a real platform user in these stats.
  const notAdmin = { id: { not: SUPER_ADMIN_ID || "__none__" } };
  const [ownUsers, onlineUsers, pendingProfiles, approvedProfiles, rejectedProfiles, pendingSearchReports, pendingChatReports, activeSessions, waitingQueue, pendingInbox] = await Promise.all([
    prisma.matchUser.count({ where: { ...notAdmin, botId } }),
    prisma.matchUser.count({ where: { ...notAdmin, botId, lastActiveAt: { gte: onlineSince } } }),
    prisma.matchProfile.count({ where: { status: "PENDING", user: { botId } } }),
    prisma.matchProfile.count({ where: { status: "APPROVED", user: { botId } } }),
    prisma.matchProfile.count({ where: { status: "REJECTED", user: { botId } } }),
    prisma.matchReport.count({ where: { status: "PENDING", source: "SEARCH", reporter: { botId } } }),
    prisma.matchReport.count({ where: { status: "PENDING", source: "RANDOM_CHAT", reporter: { botId } } }),
    prisma.randomChatSession.count({ where: { status: "ACTIVE", botId } }),
    prisma.randomChatQueue.count({ where: { status: "WAITING", botId, expiresAt: { gt: new Date() } } }),
    prisma.adminMessage.count({ where: { status: "PENDING", sender: { botId } } }),
  ]);
  const totalUsers = await countBotVisitors(botId, SUPER_ADMIN_ID, ownUsers);
  return { totalUsers, ownUsers, onlineUsers, pendingProfiles, approvedProfiles, rejectedProfiles, pendingSearchReports, pendingChatReports, activeSessions, waitingQueue, pendingInbox };
}

async function sendAdminStats(bot: TelegramBot, botId: string, chatId: number) {
  const { totalUsers, onlineUsers, pendingProfiles, approvedProfiles, rejectedProfiles, pendingSearchReports, pendingChatReports, activeSessions, waitingQueue, pendingInbox } = await adminStatsData(botId);
  const text =
    `📊 إحصائيات بوت التعارف\n\n` +
    `👥 إجمالي المستخدمين: ${totalUsers}\n` +
    `🟢 متصلون الآن: ${onlineUsers}\n\n` +
    `📋 الملفات الشخصية:\n⏳ بانتظار المراجعة: ${pendingProfiles}\n✅ معتمدة: ${approvedProfiles}\n❌ مرفوضة: ${rejectedProfiles}\n\n` +
    `🚩 البلاغات بانتظار المراجعة:\n🔍 من البحث: ${pendingSearchReports}\n🔀 من المحادثة العشوائية: ${pendingChatReports}\n\n` +
    `🔀 المحادثة العشوائية الآن:\n💬 محادثات نشطة: ${activeSessions}\n⏳ بانتظار شريك: ${waitingQueue}\n\n` +
    `📥 رسائل واردة غير مقروءة: ${pendingInbox}`;
  await bot.api.sendMessage(chatId, text);
}

// Read-only report for the admin: WHY searches come back empty, from real
// numbers instead of guesses. Counts exactly the conditions buildSearchQueue
// applies (APPROVED, not hidden, opposite gender, same bot, not country-only
// for other countries) and shows where profiles are lost.
export async function sendSearchDiagnostics(bot: TelegramBot, botId: string, chatId: number) {
  const [all, byStatus, hidden, otherBot, prefs, users] = await Promise.all([
    prisma.matchProfile.count({ where: { user: { botId } } }),
    prisma.matchProfile.groupBy({ by: ["status", "gender"], where: { user: { botId } }, _count: { _all: true } }),
    prisma.matchProfile.count({ where: { user: { botId }, status: "APPROVED", isHidden: true } }),
    prisma.matchProfile.count({ where: { user: { botId: { not: botId } } } }),
    prisma.partnerPreference.count({ where: { user: { botId } } }),
    prisma.matchUser.count({ where: { botId } }),
  ]);
  const n = (st: string, g: string) => byStatus.find((x) => x.status === st && x.gender === g)?._count._all ?? 0;
  const visible = (g: string) => n("APPROVED", g);
  const countryOnly = await prisma.matchProfilePrivacy.count({ where: { countryOnly: true } }).catch(() => null);
  const lines = [
    "🩺 فحص البحث عن شريك",
    "",
    `👥 مستخدمو هذا البوت: ${users}`,
    `📋 ملفات هذا البوت: ${all}`,
    `⏳ بانتظار المراجعة: ذكور ${n("PENDING", "MALE")} · إناث ${n("PENDING", "FEMALE")}`,
    `✅ معتمدة: ذكور ${visible("MALE")} · إناث ${visible("FEMALE")}`,
    `❌ مرفوضة: ${n("REJECTED", "MALE") + n("REJECTED", "FEMALE")}`,
    `⏸ معتمدة لكنها مخفية بقرار أصحابها: ${hidden}`,
    `💍 أصحاب مواصفات شريك محفوظة: ${prefs}`,
    countryOnly != null ? `🌍 ملفات «لدولتي فقط»: ${countryOnly}` : null,
    otherBot > 0 ? `\n⚠️ يوجد ${otherBot} ملفاً مسجّلاً على بوت آخر (botId مختلف) ولا يظهر في بحث هذا البوت.` : null,
    "",
    "ما يراه الباحث: ذكر يرى الإناث المعتمدات غير المخفيات، والعكس.",
    `→ الباحثون الذكور يرون حتى ${Math.max(0, visible("FEMALE") - 0)} ملفاً، والباحثات يرين حتى ${Math.max(0, visible("MALE") - 0)} ملفاً.`,
  ].filter((l): l is string => l !== null);
  await bot.api.sendMessage(chatId, lines.join("\n"));
}

async function sendPendingProfilesList(bot: TelegramBot, chatId: number) {
  const profiles = await prisma.matchProfile.findMany({ where: { status: "PENDING" }, orderBy: { created_at: "asc" }, take: 20 });
  if (profiles.length === 0) {
    await bot.api.sendMessage(chatId, "✅ لا توجد ملفات بانتظار المراجعة حالياً.");
    return;
  }
  for (const profile of profiles) {
    await notifyAdminNewProfile(bot, profile);
  }
}

async function sendPendingReportsList(bot: TelegramBot, chatId: number, source: "SEARCH" | "RANDOM_CHAT") {
  const reports = await prisma.matchReport.findMany({ where: { status: "PENDING", source }, orderBy: { created_at: "asc" }, take: 20 });
  if (reports.length === 0) {
    await bot.api.sendMessage(chatId, "✅ لا توجد بلاغات بانتظار المراجعة في هذا القسم.");
    return;
  }
  for (const r of reports) {
    const [reporterProfile, targetProfile] = await Promise.all([
      prisma.matchProfile.findUnique({ where: { userId: r.reporterId } }),
      prisma.matchProfile.findUnique({ where: { userId: r.targetId } }),
    ]);
    const text =
      `🚩 بلاغ ${source === "SEARCH" ? "من نتائج البحث" : "من محادثة عشوائية مجهولة"}\n\n` +
      `المُبلِّغ: ${reporterProfile?.name || "بلا ملف"} (#${shortId(r.reporterId)})\n` +
      `المُبلَّغ عنه: ${targetProfile?.name || "بلا ملف"} (#${shortId(r.targetId)})\n` +
      `${relativeTime(r.created_at)}`;
    const kb = new InlineKeyboard()
      .text("🙈 تجاهل", `mrep_ignore|${r.id}`)
      .text("🔇 كتم 24س", `mrep_mute|${r.id}`)
      .row()
      .text("⛔ حظر نهائي", `mrep_ban|${r.id}`);
    await bot.api.sendMessage(chatId, text, { reply_markup: kb }).catch(() => null);
  }
}

function inboxMessageKb(messageId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("↩️ رد", `madmin_msgreply|${messageId}`)
    .text("✅ تحديد كمقروء", `madmin_msgread|${messageId}`)
    .row()
    .text("🔇 كتم المرسل", `madmin_msgmute|${messageId}`)
    .text("⛔ حظر المرسل", `madmin_msgban|${messageId}`);
}

async function sendInboxMessages(bot: TelegramBot, chatId: number) {
  const messages = await prisma.adminMessage.findMany({ where: { status: "PENDING" }, orderBy: { created_at: "asc" }, take: 20 });
  if (messages.length === 0) {
    await bot.api.sendMessage(chatId, "✅ لا توجد رسائل واردة جديدة.");
    return;
  }
  for (const m of messages) {
    const senderProfile = await prisma.matchProfile.findUnique({ where: { userId: m.senderId } });
    const text = `📩 رسالة من ${senderProfile?.name || "بلا ملف"} (#${shortId(m.senderId)})\n🆔 ${m.senderId}\n${relativeTime(m.created_at)}\n\n${m.text}`;
    await bot.api.sendMessage(chatId, text, { reply_markup: inboxMessageKb(m.id) }).catch(() => null);
  }
}

export async function runBroadcast(bot: TelegramBot, chatId: number, text: string) {
  await auditAdmin(String(chatId), "broadcast", null, text, adminVia);
  const recipients = await prisma.matchUser.findMany({
    where: { phoneVerified: true, isBanned: false, id: { not: SUPER_ADMIN_ID || "__none__" } },
    select: { id: true },
  });
  const messageText = formatBroadcastText(text);
  let sent = 0;
  for (const r of recipients) {
    try {
      await bot.api.sendMessage(Number(r.id), messageText);
      sent++;
    } catch {
      // user blocked the bot or is unreachable — skip and keep going
    }
  }
  await bot.api.sendMessage(chatId, `✅ تم إرسال البث إلى ${sent} من أصل ${recipients.length} مستخدم.`);
}

async function sendUserLookup(bot: TelegramBot, chatId: number, rawId: string) {
  const targetId = rawId.replace(/[^0-9]/g, "");
  if (!targetId) {
    await bot.api.sendMessage(chatId, "آيدي غير صالح.");
    return;
  }
  const user = await prisma.matchUser.findUnique({ where: { id: targetId } });
  if (!user) {
    await bot.api.sendMessage(chatId, "لم يتم العثور على مستخدم بهذا الآيدي.");
    return;
  }
  const profile = await prisma.matchProfile.findUnique({ where: { userId: targetId } });
  const [likesReceived, reportsReceived, reportsGiven] = await Promise.all([
    prisma.matchLike.count({ where: { toUserId: targetId } }),
    prisma.matchReport.count({ where: { targetId } }),
    prisma.matchReport.count({ where: { reporterId: targetId } }),
  ]);
  const lines = [
    `🆔 ${targetId}`,
    `📱 تحقق الهاتف: ${user.phoneVerified ? "✅" : "❌"}`,
    `🚫 محظور: ${user.isBanned ? "نعم" : "لا"}`,
    `🔇 مكتوم: ${user.mutedUntil && user.mutedUntil > new Date() ? `نعم حتى ${user.mutedUntil.toLocaleString("ar")}` : "لا"}`,
    `❤️ إعجابات مستلمة: ${likesReceived}`,
    `🚩 بلاغات ضده: ${reportsReceived}`,
    `🚩 بلاغات قدّمها: ${reportsGiven}`,
  ];
  const profileText = profile
    ? `\n\n👤 الملف الشخصي:\nالاسم: ${profile.name}\nالحالة: ${profile.status === "APPROVED" ? "✅ معتمد" : profile.status === "REJECTED" ? "❌ مرفوض" : "⏳ قيد المراجعة"}\nمخفي عن البحث: ${profile.isHidden ? "نعم" : "لا"}`
    : "\n\n👤 لا يوجد ملف شخصي لهذا المستخدم.";
  const text = lines.join("\n") + profileText;
  const opts = profile?.status === "PENDING" ? { reply_markup: new InlineKeyboard().text("✅ قبول الملف", `madmin_approve|${targetId}`).text("❌ رفض الملف", `madmin_reject|${targetId}`) } : {};
  if (profile?.photoFileId) {
    await bot.api.sendPhoto(chatId, profile.photoFileId, { caption: text, ...opts });
  } else {
    await bot.api.sendMessage(chatId, text, opts);
  }
}

export async function runUnban(bot: TelegramBot, chatId: number, rawId: string) {
  const targetId = rawId.replace(/[^0-9]/g, "");
  if (!targetId) {
    await bot.api.sendMessage(chatId, "آيدي غير صالح.");
    return;
  }
  const user = await prisma.matchUser.findUnique({ where: { id: targetId } });
  if (!user) {
    await bot.api.sendMessage(chatId, "لم يتم العثور على مستخدم بهذا الآيدي.");
    return;
  }
  await prisma.matchUser.update({ where: { id: targetId }, data: { isBanned: false, mutedUntil: null } });
  await auditAdmin(String(chatId), "unban", targetId, null, adminVia);
  await bot.api.sendMessage(chatId, `✅ تم رفع الحظر/الكتم عن المستخدم ${targetId}.`);
  await bot.api.sendMessage(Number(targetId), "✅ تم رفع الحظر/الكتم عنك من قِبل الإدارة، يمكنك استخدام البوت الآن.").catch(() => null);
}

async function handleAdminMessage(bot: TelegramBot, botId: string, chatId: number, text: string, adminId: string) {
  if (text === "/start") {
    await bot.api.sendMessage(chatId, "🛠 لوحة تحكم مشرف بوت التعارف والزواج.", { reply_markup: adminMenu(botId) });
    return;
  }
  if (text === "🩺 فحص البحث") {
    await sendSearchDiagnostics(bot, botId, chatId);
    return;
  }
  if (text === "📊 الإحصائيات") {
    await sendAdminStats(bot, botId, chatId);
    return;
  }
  if (text === "📋 الملفات المعلقة") {
    await sendPendingProfilesList(bot, chatId);
    return;
  }
  if (text === "🚩 بلاغات المطابقة") {
    await sendPendingReportsList(bot, chatId, "SEARCH");
    return;
  }
  if (text === "🚩 بلاغات الدردشة العشوائية") {
    await sendPendingReportsList(bot, chatId, "RANDOM_CHAT");
    return;
  }
  if (text === "📢 بث جماعي") {
    await setPending(adminId, { mode: "admin_broadcast" });
    await bot.api.sendMessage(chatId, `📢 أرسل نص الرسالة التي تريد بثّها لجميع المستخدمين المُفعّلين. لإلغاء العملية اضغط أي زر آخر من القائمة.\n\n${BROADCAST_COMPOSE_HINT}`);
    return;
  }
  if (text === "🔎 بحث عن مستخدم") {
    await setPending(adminId, { mode: "admin_lookup" });
    await bot.api.sendMessage(chatId, "🔎 أرسل آيدي المستخدم (Telegram ID):");
    return;
  }
  if (text === "🔓 رفع حظر/كتم") {
    await setPending(adminId, { mode: "admin_unban" });
    await bot.api.sendMessage(chatId, "🔓 أرسل آيدي المستخدم الذي تريد رفع الحظر/الكتم عنه:");
    return;
  }
  if (text === "📥 الرسائل الواردة") {
    await sendInboxMessages(bot, chatId);
    return;
  }
  if (text.startsWith("موافقة ملف ") || text.startsWith("رفض ملف ")) {
    const approve = text.startsWith("موافقة ملف ");
    const idSuffix = text.split(" ")[2]?.trim();
    if (idSuffix) await decideProfile(bot, chatId, idSuffix, approve);
    return;
  }
  await bot.api.sendMessage(chatId, "🛠 لوحة تحكم مشرف بوت التعارف والزواج.", { reply_markup: adminMenu(botId) });
}

// ---- shared admin actions (bot buttons AND the Mini App «🛡 لوحة القيادة») -------------------
// `adminVia` only tags the audit log; the app sets it around its calls.
let adminVia: "bot" | "app" = "bot";
export async function withAdminVia<T>(via: "bot" | "app", fn: () => Promise<T>): Promise<T> {
  const prev = adminVia;
  adminVia = via;
  try { return await fn(); } finally { adminVia = prev; }
}

export async function decideVerification(bot: TelegramBot, adminId: string, targetId: string, approve: boolean) {
  await prisma.matchProfile
    .update({ where: { userId: targetId }, data: { verificationStatus: approve ? "VERIFIED" : "REJECTED" } })
    .catch(() => null);
  await auditAdmin(adminId, approve ? "verify_approve" : "verify_reject", targetId, null, adminVia);
  await bot.api
    .sendMessage(
      Number(targetId),
      approve ? "☑️ تم توثيق ملفك! ستظهر الشارة بجانب اسمك في نتائج البحث." : "❌ لم يتم قبول طلب التوثيق. رسم المراجعة غير قابل للاسترجاع."
    )
    .catch(() => null);
}

export async function inboxAction(bot: TelegramBot, chatId: number, msgId: string, kind: "read" | "mute" | "ban"): Promise<"ok" | "missing"> {
  if (kind === "read") {
    await prisma.adminMessage.update({ where: { id: msgId }, data: { status: "READ" } }).catch(() => null);
    await auditAdmin(String(chatId), "inbox_read", msgId, null, adminVia);
    return "ok";
  }
  const inboxMsg = await prisma.adminMessage.findUnique({ where: { id: msgId } });
  if (!inboxMsg) return "missing";
  if (kind === "ban") {
    await prisma.matchUser.update({ where: { id: inboxMsg.senderId }, data: { isBanned: true } }).catch(() => null);
    await bot.api.sendMessage(chatId, "⛔ تم حظر المستخدم نهائياً من البوت لتجاوزه التحذير.").catch(() => null);
  } else {
    await prisma.matchUser.update({ where: { id: inboxMsg.senderId }, data: { mutedUntil: new Date(Date.now() + 24 * 3600 * 1000) } }).catch(() => null);
    await bot.api.sendMessage(chatId, "🔇 تم كتم المستخدم لمدة 24 ساعة.").catch(() => null);
  }
  await prisma.adminMessage.update({ where: { id: msgId }, data: { status: "READ" } }).catch(() => null);
  await auditAdmin(String(chatId), `inbox_${kind}`, inboxMsg.senderId, null, adminVia);
  return "ok";
}

export async function replyToInbox(bot: TelegramBot, chatId: number, messageId: string, targetUserId: string, text: string) {
  await bot.api.sendMessage(Number(targetUserId), `↩️ رد من الإدارة:\n\n${text}`).catch(() => null);
  await prisma.adminMessage.update({ where: { id: messageId }, data: { status: "READ" } }).catch(() => null);
  await auditAdmin(String(chatId), "inbox_reply", targetUserId, text, adminVia);
  await bot.api.sendMessage(chatId, "✅ تم إرسال ردك إلى المستخدم.").catch(() => null);
}

/** 🙈 / 🔇 24س / ⛔ on a report — atomic PENDING→REVIEWED so two clicks never act twice. */
export async function resolveMatchReport(bot: TelegramBot, chatId: number, reportId: string, action: "ignore" | "mute" | "ban"): Promise<"ok" | "missing" | "already"> {
  const report = await prisma.matchReport.findUnique({ where: { id: reportId } });
  if (!report) return "missing";
  const claimed = await prisma.matchReport.updateMany({ where: { id: reportId, status: "PENDING" }, data: { status: "REVIEWED" } });
  if (claimed.count === 0) return "already";
  if (action === "ban") {
    await prisma.matchUser.update({ where: { id: report.targetId }, data: { isBanned: true } }).catch(() => null);
    await bot.api.sendMessage(chatId, "⛔ تم حظر المستخدم المُبلَّغ عنه نهائياً من البوت.").catch(() => null);
  } else if (action === "mute") {
    await prisma.matchUser.update({ where: { id: report.targetId }, data: { mutedUntil: new Date(Date.now() + 24 * 3600 * 1000) } }).catch(() => null);
    await bot.api.sendMessage(chatId, "🔇 تم كتم المستخدم لمدة 24 ساعة.").catch(() => null);
  } else {
    await bot.api.sendMessage(chatId, "🙈 تم تجاهل البلاغ.").catch(() => null);
  }
  await auditAdmin(String(chatId), `report_${action}`, report.targetId, report.source, adminVia);
  await pushNotification(report.reporterId, "report", action === "ignore" ? "🚩 راجعت الإدارة بلاغك — لم تثبت مخالفة" : "🚩 راجعت الإدارة بلاغك واتخذت إجراءً بحق الحساب. شكراً لك").catch(() => null);
  return "ok";
}

async function handleAdminCallback(bot: TelegramBot, botId: string, chatId: number, data: string, cq: any) {
  if (data.startsWith("mverify_yes|") || data.startsWith("mverify_no|")) {
    const targetId = data.split("|")[1];
    const approve = data.startsWith("mverify_yes|");
    await decideVerification(bot, String(cq.from.id), targetId, approve);
    await bot.api.answerCallbackQuery(cq.id, { text: approve ? "✅ تم التوثيق" : "❌ تم الرفض" }).catch(() => null);
    return;
  }
  if (data.startsWith("madmin_approve|") || data.startsWith("madmin_reject|")) {
    const approve = data.startsWith("madmin_approve|");
    const userId = data.split("|")[1];
    const result = await decideProfileByUserId(bot, chatId, userId, approve, { quiet: true });
    // The tapped card disappears at once (also cards sent before ids were stored).
    if (cq.message) await removeReviewMessage(bot, cq.message.chat.id, cq.message.message_id, approve ? "✅ تم القبول" : "❌ تم الرفض", !!cq.message.photo).catch(() => null);
    await bot.api.answerCallbackQuery(cq.id, { text: (result || (approve ? "✅ تم القبول" : "❌ تم الرفض")).slice(0, 190) }).catch(() => null);
    return;
  }
  if (data.startsWith("madmin_msgread|")) {
    await inboxAction(bot, chatId, data.split("|")[1], "read");
    await bot.api.answerCallbackQuery(cq.id, { text: "✅ تم التحديد كمقروء" }).catch(() => null);
    return;
  }
  if (data.startsWith("madmin_msgban|") || data.startsWith("madmin_msgmute|")) {
    const r = await inboxAction(bot, chatId, data.split("|")[1], data.startsWith("madmin_msgban|") ? "ban" : "mute");
    await bot.api.answerCallbackQuery(cq.id, r === "missing" ? { text: "الرسالة غير موجودة." } : undefined).catch(() => null);
    return;
  }
  if (data.startsWith("madmin_msgreply|")) {
    const msgId = data.split("|")[1];
    const inboxMsg = await prisma.adminMessage.findUnique({ where: { id: msgId } });
    if (!inboxMsg) {
      await bot.api.answerCallbackQuery(cq.id, { text: "الرسالة غير موجودة." }).catch(() => null);
      return;
    }
    await ensureMatchUser(botId, String(cq.from.id));
    await setPending(String(cq.from.id), { mode: "admin_reply", targetUserId: inboxMsg.senderId, messageId: msgId });
    await bot.api.sendMessage(chatId, "↩️ اكتب ردك الآن وسيصل مباشرة إلى المُرسل:");
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("mrep_")) {
    const [action, reportId] = data.split("|");
    const r = await resolveMatchReport(bot, chatId, reportId, action === "mrep_ban" ? "ban" : action === "mrep_mute" ? "mute" : "ignore");
    await bot.api.answerCallbackQuery(cq.id, r === "missing" ? { text: "البلاغ غير موجود." } : r === "already" ? { text: "تمت مراجعة هذا البلاغ مسبقاً." } : undefined).catch(() => null);
    return;
  }
  await bot.api.answerCallbackQuery(cq.id).catch(() => null);
}

// ---------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------
export async function handleMarriageBotUpdate(bot: TelegramBot, botRow: BotRow, update: any) {
  // Hybrid mode (2026-10-14, additive): inline search + consent chat requests.
  if (update.inline_query) {
    await handleMatchInlineQuery(bot, botRow, update.inline_query);
    return;
  }
  if (update.callback_query && (await handleHybridCallback(bot, botRow, update.callback_query))) return;
  if (update.callback_query) {
    await handleMatchCallback(bot, botRow, update.callback_query);
    return;
  }
  const msg = update.message;
  if (!msg?.from || !msg.chat) return;
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);

  if (SUPER_ADMIN_ID && tgUserId === SUPER_ADMIN_ID) {
    const text = String(msg.text || "").trim();
    if (!text) return;
    // The admin gets a MatchUser row too, purely to persist their own
    // pendingAction between messages (broadcast/lookup/unban each need a
    // follow-up message) — excluded from all user-facing stats/broadcasts.
    const adminUser = await ensureMatchUser(botRow.id, tgUserId);
    const adminPending = adminUser.pendingAction as PendingAction | null;
    if (adminPending && !ADMIN_COMMANDS.has(text)) {
      await setPending(tgUserId, null);
      if (adminPending.mode === "admin_broadcast") {
        await runBroadcast(bot, chatId, text);
        return;
      }
      if (adminPending.mode === "admin_lookup") {
        await sendUserLookup(bot, chatId, text);
        return;
      }
      if (adminPending.mode === "admin_unban") {
        await runUnban(bot, chatId, text);
        return;
      }
      if (adminPending.mode === "admin_reply") {
        await replyToInbox(bot, chatId, adminPending.messageId, adminPending.targetUserId, text);
        return;
      }
    }
    if (adminPending) await setPending(tgUserId, null);
    await handleAdminMessage(bot, botRow.id, chatId, text, tgUserId);
    return;
  }

  // AD_BOT hands out "/start adv_<AdClickId>" deep links when a campaign
  // promotes this very bot — consuming it here marks that click verified
  // instantly (see src/lib/adVerifyPayload.ts). Checked against the raw
  // payload directly, independent of the ref_ referral-code match below,
  // so the two can never collide.
  const startPayload = typeof msg.text === "string" ? msg.text.match(/^\/start(?:@\w+)?\s+(\S+)/)?.[1] : null;
  if (startPayload && isAdVerifyPayload(startPayload)) {
    await consumeAdVerifyPayload(startPayload);
  }

  // Referral capture (owner spec, 2026-09-05) — only meaningful on a
  // brand-new user's very first /start; ensureMatchUser only writes
  // referredBy on creation, never overwrites an existing row.
  // ref_<id> (own link) or ath_<id> (the same referral, shared from Athar — see docs/MATCH_ATHAR.md).
  const refMatch = typeof msg.text === "string" ? msg.text.match(/^\/start(?:@\w+)?\s+(?:ref|ath)_(\d+)/) : null;
  if (typeof msg.text === "string" && /^\/start(?:@\w+)?\s+ath_\d+/.test(msg.text)) void trackFunnel(tgUserId, "athar_arrival", refMatch?.[1], "bot");
  const user = await ensureMatchUser(botRow.id, tgUserId, refMatch?.[1]);
  await recordBotVisit(botRow.id, tgUserId);
  await prisma.matchUser.update({ where: { id: tgUserId }, data: { lastActiveAt: new Date() } }).catch(() => null);

  if (user.isBanned) {
    await bot.api.sendMessage(chatId, "🚫 تم حظرك من استخدام هذا البوت من قِبل الإدارة.");
    return;
  }
  if (user.mutedUntil && user.mutedUntil > new Date()) {
    await bot.api.sendMessage(chatId, "🔇 أنت مكتوم مؤقتاً بسبب مخالفة بلّغ عنها أحد المستخدمين. حاول لاحقاً.");
    return;
  }

  if (msg.successful_payment) {
    const sp = msg.successful_payment;
    const parsed = parseStarsPayload(String(sp.invoice_payload || ""));
    if (parsed?.kind === "MATCH_DEPOSIT" && parsed.userId === tgUserId) {
      const usd = usdForStars(Number(sp.total_amount || 0));
      const outcome = await creditStarsPayment(
        "match-stars",
        async (tx) => {
          await tx.matchTransaction.create({
            data: { userId: tgUserId, amount: usd, currency: "stars", type: "DEPOSIT", status: "COMPLETED", txHash: sp.telegram_payment_charge_id },
          });
        },
        async (tx) => {
          await tx.matchUser.update({ where: { id: tgUserId }, data: { balance: { increment: usd } } });
        }
      );
      if (outcome !== "duplicate") {
        const updated = await prisma.matchUser.findUnique({ where: { id: tgUserId } });
        await bot.api.sendMessage(chatId, `✅ تم شحن $${usd.toFixed(2)} في رصيدك.\n💰 رصيدك الحالي: $${Number(updated?.balance || 0).toFixed(2)}`, { reply_markup: upgradesMenu() });
      }
    }
    // ⚡ «اشترِ الآن بالنجوم» (app + bot): tops up the exact shortfall, then activates the
    // feature from balance. Idempotent: the Stars charge id is the ledger's unique txHash,
    // so a redelivered update credits nothing and activates nothing twice.
    if (parsed?.kind.startsWith("MATCH_BUY_") && parsed.userId === tgUserId) {
      const key = parsed.kind.slice("MATCH_BUY_".length);
      const usd = usdForStars(Number(sp.total_amount || 0));
      const outcome = await creditStarsPayment(
        "match-stars-buy",
        async (tx) => { await tx.matchTransaction.create({ data: { userId: tgUserId, amount: usd, currency: "stars", type: "DEPOSIT", status: "COMPLETED", txHash: sp.telegram_payment_charge_id } }); },
        async (tx) => { await tx.matchUser.update({ where: { id: tgUserId }, data: { balance: { increment: usd } } }); },
      );
      if (outcome === "ok") {
        void trackFunnel(tgUserId, "stars_paid", key, "bot");
        const r = isBuyNowKey(key) ? await purchaseByKey(tgUserId, key) : null;
        if (r?.ok) void trackFunnel(tgUserId, "purchase_success", key, "bot");
        const updated = await prisma.matchUser.findUnique({ where: { id: tgUserId } });
        await bot.api.sendMessage(chatId, `${r?.ok ? r.message : `✅ تم شحن $${usd.toFixed(2)} في رصيدك (لم تُفعَّل الميزة تلقائياً — فعّلها من «⭐ الترقيات والمزايا»).`}\n💰 رصيدك الحالي: $${Number(updated?.balance || 0).toFixed(2)}`, { reply_markup: upgradesMenu() }).catch(() => null);
      }
    }
    return;
  }

  if (msg.contact) {
    if (String(msg.contact.user_id) === tgUserId) {
      await prisma.matchUser.update({ where: { id: tgUserId }, data: { phoneNumber: msg.contact.phone_number, phoneVerified: true } });
      await bot.api.sendMessage(chatId, "✅ تم التحقق من رقم هاتفك.", { reply_markup: mainMenu() });
    } else {
      await bot.api.sendMessage(chatId, "⚠️ يجب مشاركة رقم هاتفك أنت، وليس رقم شخص آخر.");
    }
    return;
  }

  if (!user.phoneVerified) {
    await bot.api.sendMessage(
      chatId,
      "📱 التحقق من رقم الهاتف خطوة إلزامية قبل استخدام هذا البوت، لحماية جميع الأعضاء.",
      { reply_markup: new Keyboard().requestContact("📱 مشاركة رقم الهاتف").resized() }
    );
    return;
  }

  // Hybrid mode (2026-10-14): Mini App menu button + /start profile_<id> deep
  // links from inline results. Runs after the ban/mute/phone gates on purpose.
  if (typeof msg.text === "string" && msg.text.startsWith("/start")) {
    await ensureMiniAppMenu(bot, botRow, chatId);
    const profileRef = parseProfileStart(startPayload);
    const curMode = (user.pendingAction as any)?.mode;
    if (profileRef && curMode !== "random_chatting" && curMode !== "fake_chatting") {
      await openProfileDeepLink(bot, botRow, chatId, tgUserId, profileRef);
      return;
    }
    if (startPayload === "app") {
      await bot.api.sendMessage(chatId, "💍 افتح التطبيق لإدارة ملفك وتصفّح المطابقات:", {
        reply_markup: new InlineKeyboard().webApp("فتح التطبيق 💍", miniAppUrl(botRow.id)),
      });
      return;
    }
  }

  const pending = user.pendingAction as PendingAction | null;

  // Photo/voice steps must be checked before the text-only bailout below —
  // neither is a text message, so the normal consumeProfileStep dispatch
  // (which only handles msg.text) never sees them.
  if (msg.photo && pending?.mode === "profile_wizard" && pending.step === "photo") {
    pending.data.photoFileId = msg.photo[msg.photo.length - 1].file_id;
    await advanceProfileStep(bot, chatId, tgUserId, "photo", pending.data);
    return;
  }
  if (msg.voice && pending?.mode === "profile_wizard" && pending.step === "voice") {
    pending.data.voiceFileId = msg.voice.file_id;
    await advanceProfileStep(bot, chatId, tgUserId, "voice", pending.data);
    return;
  }
  if (msg.photo && pending?.mode === "verify_badge_photo") {
    const charge = await chargeMatchUser(tgUserId, PRICE_VERIFIED_BADGE, "VERIFIED_BADGE");
    if (!charge.ok) {
      await setPending(tgUserId, null);
      await bot.api.sendMessage(chatId, insufficientBalanceText(tgUserId, PRICE_VERIFIED_BADGE, charge.balance), { reply_markup: upgradesMenu() });
      return;
    }
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    await prisma.matchProfile.update({ where: { userId: tgUserId }, data: { verificationStatus: "PENDING", verificationPhotoFileId: fileId } });
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "✅ تم استلام طلب التوثيق، سيصلك إشعار خلال 48 ساعة.", { reply_markup: mainMenu() });
    if (SUPER_ADMIN_ID) {
      await bot.api
        .sendPhoto(Number(SUPER_ADMIN_ID), fileId, {
          caption: `☑️ طلب توثيق من #${shortId(tgUserId)}`,
          reply_markup: new InlineKeyboard().text("✅ توثيق", `mverify_yes|${tgUserId}`).text("❌ رفض", `mverify_no|${tgUserId}`),
        })
        .catch(() => null);
    }
    return;
  }
  if (msg.photo && pending?.mode === "extra_photo_upload") {
    const fileId = msg.photo[msg.photo.length - 1].file_id;
    const field = pending.slot === 2 ? "photoFileId2" : "photoFileId3";
    await prisma.matchProfile.update({ where: { userId: tgUserId }, data: { [field]: fileId } });
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "✅ تم إضافة الصورة.", { reply_markup: upgradesMenu() });
    return;
  }

  const text = String(msg.text || "").trim();
  if (!text) return;

  if (isBack(text)) {
    if (pending?.mode === "superlike_note" && (await resumeBrowsing(tgUserId, pending.resume))) {
      await bot.api.sendMessage(chatId, "تم الإلغاء. اضغط «➡️ الملف التالي» على البطاقة لمتابعة التصفح.", { reply_markup: mainMenu() });
      return;
    }
    if (pending?.mode === "fake_chatting") {
      await setPending(tgUserId, null);
      await bot.api.sendMessage(chatId, "🏠 القائمة الرئيسية:", { reply_markup: mainMenu() });
      return;
    }
    if (pending?.mode === "random_chatting") {
      await endRandomChat(bot, tgUserId, pending.sessionId, pending.partnerId, "end");
      return;
    }
    if (pending?.mode === "random_waiting") {
      // Cancel the still-open queue row instead of just clearing local
      // pending state — otherwise a partner arriving within the leftover
      // expiresAt window can still match against a user who already left,
      // flipping them straight into "connected" with no one really there.
      await prisma.randomChatQueue.updateMany({
        where: { userId: tgUserId, status: "WAITING" },
        data: { status: "CANCELLED" },
      });
    }
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "🏠 القائمة الرئيسية:", { reply_markup: mainMenu() });
    return;
  }

  if (text === "/start") {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, startGuide("MATCH"), { reply_markup: mainMenu() });
    return;
  }

  // Active fake bot chat: handle control buttons and relay to script.
  if (pending?.mode === "fake_chatting") {
    if (text === "⏹ إنهاء المحادثة") {
      await setPending(tgUserId, null);
      await bot.api.sendMessage(chatId, "🏠 القائمة الرئيسية:", { reply_markup: mainMenu() });
      return;
    }
    await handleFakeBotReply(bot, chatId, tgUserId, pending, text);
    return;
  }

  // Active random chat: relay text, or handle its own control buttons.
  if (pending?.mode === "random_chatting") {
    if (text === "⏹ إنهاء المحادثة") {
      await bot.api
        .sendMessage(chatId, "قبل الإنهاء — اختر سبباً مختصراً (تُرسَل رسالة شكر لطيفة تلقائياً للطرف الآخر بدل الاختفاء المفاجئ):", { reply_markup: exitReasonKeyboard() })
        .catch(() => null);
      return;
    }
    if (text === "⛔ حظر") {
      await endRandomChat(bot, tgUserId, pending.sessionId, pending.partnerId, "block");
      return;
    }
    if (text === "🚩 إبلاغ") {
      await reportRandomChat(bot, chatId, tgUserId, pending.partnerId);
      return;
    }
    if (text === "🎛 فلاتر الدردشة") {
      await showAnonFiltersMenu(bot, chatId, tgUserId);
      return;
    }
    await relayRandomChatText(bot, chatId, tgUserId, pending as any, text);
    return;
  }

  if (pending?.mode === "random_waiting" && text === "🔀 مراسلة عشوائية") {
    await startRandomChat(bot, chatId, botRow, tgUserId);
    return;
  }

  if (text === "👤 ملفي الشخصي") {
    const profile = await prisma.matchProfile.findUnique({ where: { userId: tgUserId } });
    if (!profile) {
      await startProfileWizard(bot, chatId, tgUserId);
      return;
    }
    const statusLabel = profile.status === "APPROVED" ? "✅ معتمد" : profile.status === "REJECTED" ? "❌ مرفوض" : "⏳ قيد المراجعة";
    const visibilityLabel = profile.isHidden ? "⏸ مخفي عن نتائج البحث" : "🟢 ظاهر في نتائج البحث";
    const toggleLabel = profile.isHidden ? "▶️ إظهار ملفي" : "⏸ إخفاء ملفي مؤقتاً";
    const onlyMine = (await countryOnlyOwners([tgUserId])).has(tgUserId);
    const infoText = `👤 ملفك الشخصي\n\nالاسم: ${profile.name}\nالعمر: ${profile.age}\nالدولة: ${profile.country}\nالحالة: ${statusLabel}\nالظهور: ${visibilityLabel}\nمن يرى ملفي: ${onlyMine ? `🌍 ${profile.country} فقط` : "🌐 الجميع"}\n\nلتعديل الملف أرسل «✏️ تعديل».`;
    const countryOnly = (await countryOnlyOwners([tgUserId])).has(tgUserId);
    const kb = new Keyboard()
      .text("✏️ تعديل").text(toggleLabel).row()
      .text(countryOnly ? "🌐 إظهار ملفي للجميع" : "🌍 إظهار ملفي لدولتي فقط").row()
      .text("🗑 حذف ملفي نهائياً").row().text(backLabel()).resized();
    if (profile.photoFileId) {
      await bot.api.sendPhoto(chatId, profile.photoFileId, { caption: infoText, reply_markup: kb });
    } else {
      await bot.api.sendMessage(chatId, infoText, { reply_markup: kb });
    }
    return;
  }
  if (text === "✏️ تعديل") {
    await startProfileWizard(bot, chatId, tgUserId);
    return;
  }
  if (text === "⏸ إخفاء ملفي مؤقتاً" || text === "▶️ إظهار ملفي") {
    const profile = await prisma.matchProfile.findUnique({ where: { userId: tgUserId } });
    if (!profile) {
      await bot.api.sendMessage(chatId, "لا يوجد ملف شخصي بعد.", { reply_markup: mainMenu() });
      return;
    }
    const newHidden = !profile.isHidden;
    await prisma.matchProfile.update({ where: { userId: tgUserId }, data: { isHidden: newHidden } });
    await bot.api.sendMessage(
      chatId,
      newHidden ? "⏸ تم إخفاء ملفك مؤقتاً عن نتائج البحث." : "▶️ تم إظهار ملفك في نتائج البحث مجدداً.",
      { reply_markup: mainMenu() }
    );
    return;
  }
  if (text === "🌍 إظهار ملفي لدولتي فقط" || text === "🌐 إظهار ملفي للجميع") {
    const profile = await prisma.matchProfile.findUnique({ where: { userId: tgUserId } });
    if (!profile) {
      await bot.api.sendMessage(chatId, "لا يوجد ملف شخصي بعد.", { reply_markup: mainMenu() });
      return;
    }
    const on = text === "🌍 إظهار ملفي لدولتي فقط";
    try {
      await prisma.matchProfilePrivacy.upsert({ where: { userId: tgUserId }, update: { countryOnly: on }, create: { userId: tgUserId, countryOnly: on } });
      await bot.api.sendMessage(
        chatId,
        on ? `🌍 تم. ملفك يظهر الآن فقط لمن هم من ${profile.country}.` : "🌐 تم. ملفك يظهر الآن للجميع.",
        { reply_markup: mainMenu() }
      );
    } catch {
      await bot.api.sendMessage(chatId, "⚠️ هذه الميزة غير مفعّلة بعد، حاول لاحقاً.", { reply_markup: mainMenu() });
    }
    return;
  }
  if (text === "🗑 حذف ملفي نهائياً") {
    const profile = await prisma.matchProfile.findUnique({ where: { userId: tgUserId } });
    if (!profile) {
      await bot.api.sendMessage(chatId, "لا يوجد ملف شخصي لحذفه.", { reply_markup: mainMenu() });
      return;
    }
    await setPending(tgUserId, { mode: "confirm_delete_profile" });
    await bot.api.sendMessage(
      chatId,
      "⚠️ هل أنت متأكد من حذف ملفك الشخصي نهائياً؟ لن تظهر بعدها في نتائج بحث أحد، ولا يمكن التراجع عن هذا.",
      { reply_markup: confirmDeleteMenu() }
    );
    return;
  }
  if (pending?.mode === "confirm_delete_profile") {
    if (text === DELETE_CONFIRM_LABEL) {
      await prisma.matchProfile.delete({ where: { userId: tgUserId } }).catch(() => null);
      await setPending(tgUserId, null);
      await bot.api.sendMessage(chatId, "🗑 تم حذف ملفك الشخصي نهائياً. يمكنك إنشاء ملف جديد في أي وقت.", { reply_markup: mainMenu() });
    } else {
      await setPending(tgUserId, null);
      await bot.api.sendMessage(chatId, "تم الإلغاء.", { reply_markup: mainMenu() });
    }
    return;
  }
  if (text === "💍 مواصفات الشريك") {
    const profile = await prisma.matchProfile.findUnique({ where: { userId: tgUserId } });
    await startPrefWizard(bot, chatId, tgUserId, profile?.gender as Gender | undefined);
    return;
  }
  if (text === "🔍 البحث عن شريك") {
    await startSearch(bot, chatId, tgUserId, botRow.id);
    return;
  }
  if (text === "🎯 بحث دقيق" || text === "🎯 بحث دقيق (للمشتركين)") {
    const dbUser = await prisma.matchUser.findUnique({ where: { id: tgUserId } });
    if (!dbUser || !hasAdvancedFilters(dbUser)) {
      await bot.api.sendMessage(
        chatId,
        `🎯 البحث الدقيق يعرض فقط الملفات التي تطابق كل مواصفاتك (الدولة، العمر، الوظيفة، التعليم، المدينة، الحالة الاجتماعية).\n\nيعمل بعد تفعيل «🎯 فلاتر متقدمة» ($${PRICE_ADVANCED_FILTERS}) أو «👑 العضوية الذهبية» من هذه القائمة.`,
        { reply_markup: upgradesMenu() }
      );
      return;
    }
    await startSearch(bot, chatId, tgUserId, botRow.id, undefined, true);
    return;
  }
  if (text === ANON_FILTERS_BUTTON() || text === ANON_FILTERS_BUTTON(true) || text === "🎛 فلاتر الدردشة") {
    await showAnonFiltersMenu(bot, chatId, tgUserId);
    return;
  }
  if (text === "🔀 مراسلة عشوائية") {
    await startRandomChat(bot, chatId, botRow, tgUserId);
    return;
  }
  if (text === "💌 من أعجب بي") {
    await showLikedBy(bot, chatId, tgUserId);
    return;
  }
  if (text === "ℹ️ معلومات") {
    const me = await bot.api.getMe();
    const info =
      `ℹ️ بوت التعارف والزواج الشرعي\n\n` +
      `بوت متكامل للتعارف بهدف الزواج، يعمل بخوارزمية مطابقة ذكية تحلّل ملفك ومواصفات الشريك الذي تبحث عنه.\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📌 طريقة الاستخدام:\n` +
      `1️⃣ أنشئ ملفك الشخصي من «👤 ملفي الشخصي» — الاسم والعمر والدولة والحالة والصورة.\n` +
      `2️⃣ حدد مواصفات الشريك من «💍 مواصفات الشريك» — العمر والدولة والحالة المطلوبة.\n` +
      `3️⃣ اضغط «🔍 البحث عن شريك»: تظهر الملفات الأقرب لمواصفاتك أولاً مع نسبة التوافق، و«➡️ الملف التالي» يستبدل البطاقة بملف آخر. «📖 المزيد من المعلومات» يعرض بقية التفاصيل.\n` +
      `4️⃣ أعجبك ملف؟ اضغط إعجاب — إذا أُعجب الطرف الآخر بك أيضاً يصل كلاً منكما إشعار «إعجاب متبادل» مع زر للمراسلة.\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `🔀 المراسلة العشوائية:\n` +
      `• محادثة مجهولة فورية مع شخص عشوائي.\n` +
      `• تعارف دون كشف الهوية — إذا أعجبكما الحديث تقرران المتابعة.\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `💌 من أعجب بي:\n` +
      `• شاهد من أبدى إعجابه بملفك وقرر إن كنت تبادله الإعجاب.\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `⭐ الترقيات والمزايا:\n` +
      `• 🚀 رفع ملفي — يظهر ملفك في أعلى نتائج البحث 24 ساعة.\n` +
      `• ☑️ توثيق الملف — شارة توثيق تزيد الثقة بملفك.\n` +
      `• 🖼 صور إضافية — أضف صوراً أكثر لملفك.\n` +
      `• 👀 من زار ملفي — اعرف من اطّلع على ملفك.\n` +
      `• 🎯 فلاتر متقدمة — فلترة حسب المدينة والحالة الاجتماعية.\n` +
      `• 🎯 بحث دقيق — يعرض فقط الملفات التي تطابق كل مواصفاتك (للمشتركين في الفلاتر المتقدمة أو الذهبية).\n` +
      `• 👑 العضوية الذهبية — كل المزايا مجتمعة + وضع التخفي.\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `🔒 الخصوصية والأمان:\n` +
      `• لا تُشارَك بياناتك حتى تختار أنت بدء التواصل.\n` +
      `• ملفك يظهر فور حفظه، وتراجعه الإدارة لاحقاً وقد ترفضه إن خالف الشروط.\n` +
      `• يمكنك إيقاف ظهور ملفك أو حذفه في أي وقت، أو جعله ظاهراً لأهل دولتك فقط من «👤 ملفي الشخصي».\n\n` +
      `🎁 ادعُ أصدقاءك — عند اعتماد ملف صديق دعوته، يُرفع ملفك مجاناً 24 ساعة.\n\n` +
      `📲 شارك البوت: https://t.me/${me.username}`;
    await bot.api.sendMessage(chatId, info, { reply_markup: infoMenu() });
    return;
  }
  if (text === "📩 مراسلة الأدمن") {
    await bot.api.sendMessage(chatId, CONTACT_ADMIN_WARNING, { reply_markup: contactAdminConfirmMenu() });
    return;
  }
  if (text === "🔗 دعوة رابط البوت") {
    const me = await bot.api.getMe();
    await bot.api.sendMessage(
      chatId,
      `🔗 شارك هذا الرابط مع أصدقائك لدعوتهم لاستخدام البوت:\n\nhttps://t.me/${me.username}?start=ref_${tgUserId}\n\n🎁 عند اعتماد الإدارة لملف أي صديق دعوته عبر هذا الرابط، تحصل تلقائياً على رفع مجاني لملفك لمدة 24 ساعة.`,
      { reply_markup: infoMenu() }
    );
    return;
  }
  // ---------------------------------------------------------------------
  // Paid features menu (owner spec, 2026-09-05)
  // ---------------------------------------------------------------------
  if (text === "⭐ الترقيات والمزايا") {
    const disc = await firstPurchaseEligible(tgUserId).catch(() => false);
    await bot.api.sendMessage(chatId, `⭐ الترقيات والمزايا المدفوعة — اختر ما يناسبك:${disc ? `\n🎁 خصم ${Math.round(FIRST_PURCHASE_DISCOUNT * 100)}% على أول ترقية (مرة واحدة) — الأسعار أدناه بعد الخصم.` : ""}`, { reply_markup: upgradesMenu(disc) });
    return;
  }
  if (text === "💰 رصيدي وإيداع") {
    const u = await prisma.matchUser.findUnique({ where: { id: tgUserId } });
    const balance = Number(u?.balance || 0);
    await bot.api.sendMessage(chatId, depositChoicesText(balance, depositLink(tgUserId), isNativeTonConfigured()), { reply_markup: upgradesMenu() });
    await bot.api.sendMessage(chatId, "⭐ أو اشحن رصيدك مباشرة بنجوم تيليجرام:", { reply_markup: starsDepositKeyboard("mstars") });
    return;
  }
  if (text === "🔷 إيداع TON / USDT مباشر" && isNativeTonConfigured()) {
    const address = getMasterHotWalletAddress()!;
    const memo = await getOrCreateMatchTonMemo(tgUserId);
    await bot.api.sendMessage(
      chatId,
      `🔷 إيداع TON أو USDT مباشر (أسرع وأقل رسوماً من الدفع بالطريقة الأخرى)\n\nأرسل TON أو USDT (فقط على شبكة TON) إلى العنوان التالي، مع كتابة المذكرة (Memo/Comment) بالضبط كما هي — بدونها لن يُحتسب إيداعك:\n\nالعنوان:\n${address}\n\nالمذكرة:\n${memo}\n\n⚠️ لا ترسل USDT من شبكة أخرى (TRC20/ERC20 وغيرها) لهذا العنوان.\n\nيُضاف الرصيد تلقائياً خلال دقائق من تأكيد الشبكة.`,
      { reply_markup: upgradesMenu() }
    );
    return;
  }
  if (isUpgradeLabel(text, "boost")) {
    const r = await purchaseBoost(tgUserId);
    if (!r.ok && r.reason === "no_profile") {
      await bot.api.sendMessage(chatId, "⚠️ يجب إنشاء ملفك الشخصي أولاً.", { reply_markup: upgradesMenu() });
      return;
    }
    if (!r.ok && r.reason === "vip_included") {
      await bot.api.sendMessage(
        chatId,
        "✨ اشتراكك الذهبي (VIP) يشمل رفعاً مستمراً لملفك بالفعل — لا حاجة لشراء رفع إضافي.",
        { reply_markup: upgradesMenu() }
      );
      return;
    }
    if (!r.ok) {
      if (r.reason === "insufficient") await bot.api.sendMessage(chatId, insufficientBalanceText(tgUserId, r.needed, r.balance), { reply_markup: upgradesMenu() });
      return;
    }
    await bot.api.sendMessage(chatId, `🚀 تم رفع ملفك! سيظهر أولاً في نتائج البحث حتى ${r.boostedUntil.toLocaleString("ar")}.`, { reply_markup: upgradesMenu() });
    return;
  }
  if (isUpgradeLabel(text, "verify")) {
    const profile = await prisma.matchProfile.findUnique({ where: { userId: tgUserId } });
    if (!profile) {
      await bot.api.sendMessage(chatId, "⚠️ يجب إنشاء ملفك الشخصي أولاً.", { reply_markup: upgradesMenu() });
      return;
    }
    if (profile.verificationStatus === "VERIFIED") {
      await bot.api.sendMessage(chatId, "✅ ملفك موثّق بالفعل.", { reply_markup: upgradesMenu() });
      return;
    }
    if (profile.verificationStatus === "PENDING") {
      await bot.api.sendMessage(chatId, "⏳ طلب التوثيق الخاص بك قيد المراجعة.", { reply_markup: upgradesMenu() });
      return;
    }
    await setPending(tgUserId, { mode: "verify_badge_photo" });
    await bot.api.sendMessage(
      chatId,
      `☑️ أرسل صورة واضحة لهويتك الرسمية (سيُخصم $${PRICE_VERIFIED_BADGE} عند الإرسال، رسم مراجعة غير قابل للاسترجاع — لن تُعرض الصورة لأي مستخدم آخر، للمراجعة الإدارية فقط):`,
      { reply_markup: plainBackMenu() }
    );
    return;
  }
  if (isUpgradeLabel(text, "photos")) {
    const r = await unlockExtraPhotos(tgUserId);
    if (!r.ok && r.reason === "no_profile") {
      await bot.api.sendMessage(chatId, "⚠️ يجب إنشاء ملفك الشخصي أولاً.", { reply_markup: upgradesMenu() });
      return;
    }
    if (!r.ok) {
      if (r.reason === "insufficient") await bot.api.sendMessage(chatId, insufficientBalanceText(tgUserId, r.needed, r.balance), { reply_markup: upgradesMenu() });
      return;
    }
    const profile = r.profile;
    const slot: 2 | 3 | null = !profile.photoFileId2 ? 2 : !profile.photoFileId3 ? 3 : null;
    if (!slot) {
      await bot.api.sendMessage(chatId, "لديك بالفعل الحد الأقصى من الصور (3).", { reply_markup: upgradesMenu() });
      return;
    }
    await setPending(tgUserId, { mode: "extra_photo_upload", slot });
    await bot.api.sendMessage(chatId, "🖼 أرسل الصورة الإضافية الآن:", { reply_markup: plainBackMenu() });
    return;
  }
  if (isUpgradeLabel(text, "visitors")) {
    const r = await unlockProfileVisitors(tgUserId);
    if (!r.ok) {
      if (r.reason === "insufficient") await bot.api.sendMessage(chatId, insufficientBalanceText(tgUserId, r.needed, r.balance), { reply_markup: upgradesMenu() });
      return;
    }
    const visits = await prisma.matchProfileVisit.findMany({ where: { ownerId: tgUserId }, orderBy: { visitedAt: "desc" }, take: 20 });
    if (visits.length === 0) {
      await bot.api.sendMessage(chatId, "😔 لا يوجد زوار لملفك حتى الآن.", { reply_markup: upgradesMenu() });
      return;
    }
    const lines = await Promise.all(
      visits.map(async (v) => {
        const p = await prisma.matchProfile.findUnique({ where: { userId: v.viewerId } });
        return `👤 ${p?.name || "بلا ملف"} (#${shortId(v.viewerId)}) — ${relativeTime(v.visitedAt)}`;
      })
    );
    await bot.api.sendMessage(chatId, `👀 آخر زوار ملفك:\n\n${lines.join("\n")}`, { reply_markup: upgradesMenu() });
    return;
  }
  if (isUpgradeLabel(text, "filters")) {
    const r = await unlockAdvancedFilters(tgUserId);
    if (!r.ok && r.reason === "no_pref") {
      await bot.api.sendMessage(chatId, "⚠️ يجب تحديد «💍 مواصفات الشريك» الأساسية أولاً.", { reply_markup: upgradesMenu() });
      return;
    }
    if (!r.ok) {
      if (r.reason === "insufficient") await bot.api.sendMessage(chatId, insufficientBalanceText(tgUserId, r.needed, r.balance), { reply_markup: upgradesMenu() });
      return;
    }
    await setPending(tgUserId, { mode: "advanced_filter_wizard", step: "city", data: {} });
    await bot.api.sendMessage(chatId, "🎯 المدينة المطلوبة للشريك:", { reply_markup: skipMenu() });
    return;
  }
  if (isUpgradeLabel(text, "vip")) {
    const r = await purchaseVip(tgUserId);
    if (!r.ok) {
      if (r.reason === "insufficient") await bot.api.sendMessage(chatId, insufficientBalanceText(tgUserId, r.needed, r.balance), { reply_markup: upgradesMenu() });
      return;
    }
    const vipUntil = r.vipUntil;
    await bot.api.sendMessage(
      chatId,
      `👑 تم تفعيل العضوية الذهبية حتى ${vipUntil.toLocaleString("ar")}!\nتشمل: رفع مستمر للملف، فلاتر متقدمة، من زار ملفي، ووضع التخفي.`,
      { reply_markup: upgradesMenu() }
    );
    return;
  }
  if (text === "🕶 وضع التخفي (ضمن الذهبية)") {
    const r = await toggleIncognito(tgUserId);
    if (!r.ok && r.reason === "not_vip") {
      await bot.api.sendMessage(chatId, "🕶 وضع التخفي متاح فقط للأعضاء الذهبيين. فعّل «👑 العضوية الذهبية» أولاً.", { reply_markup: upgradesMenu() });
      return;
    }
    if (!r.ok) {
      await bot.api.sendMessage(chatId, "⚠️ يجب إنشاء ملفك الشخصي أولاً.", { reply_markup: upgradesMenu() });
      return;
    }
    const newState = r.on;
    await bot.api.sendMessage(chatId, newState ? "🕶 تم تفعيل وضع التخفي." : "👁 تم إيقاف وضع التخفي.", { reply_markup: upgradesMenu() });
    return;
  }

  if (text === CONTACT_ADMIN_CONFIRM_LABEL) {
    await setPending(tgUserId, { mode: "contact_admin_compose" });
    await bot.api.sendMessage(chatId, "✍️ اكتب رسالتك للإدارة الآن وأرسلها في رسالة واحدة:", { reply_markup: plainBackMenu() });
    return;
  }
  if (pending?.mode === "contact_admin_compose") {
    const savedMsg = await prisma.adminMessage.create({ data: { senderId: tgUserId, text } });
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "✅ تم إرسال رسالتك إلى الإدارة.", { reply_markup: mainMenu() });
    if (SUPER_ADMIN_ID) {
      const senderProfile = await prisma.matchProfile.findUnique({ where: { userId: tgUserId } });
      await bot.api
        .sendMessage(
          Number(SUPER_ADMIN_ID),
          `📩 رسالة جديدة من مستخدم\n\nمن: ${senderProfile?.name || "بلا ملف"} (#${shortId(tgUserId)})\n\n${text}`,
          { reply_markup: inboxMessageKb(savedMsg.id) }
        )
        .catch(() => null);
    }
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
  if (pending?.mode === "ask_nova") {
    if (!text) return;
    await bot.api.sendChatAction(chatId, "typing").catch(() => null);
    const result = await askNovaAssist(tgUserId, text);
    await bot.api.sendMessage(chatId, result.ok ? result.text! : (result.error || "تعذّر الحصول على رد الآن."), { reply_markup: plainBackMenu() });
    return;
  }
  if (pending?.mode === "attributes_ai_review") {
    await bot.api.sendMessage(chatId, "اختر إحدى النسختين بالضغط على أحد الزرين أعلاه.");
    return;
  }

  if (pending?.mode === "profile_wizard") {
    await consumeProfileStep(bot, chatId, tgUserId, pending, text);
    return;
  }
  if (pending?.mode === "pref_wizard") {
    const profile = await prisma.matchProfile.findUnique({ where: { userId: tgUserId } });
    await consumePrefStep(bot, chatId, tgUserId, pending, text, profile?.gender as Gender | undefined);
    return;
  }

  if (pending?.mode === "advanced_filter_wizard") {
    if (isManual(text)) {
      await bot.api.sendMessage(chatId, "✍️ اكتب إجابتك الآن:", { reply_markup: plainBackMenu() });
      return;
    }
    if (pending.step === "city") {
      pending.data.city = isSkip(text) ? null : text;
      await setPending(tgUserId, { mode: "advanced_filter_wizard", step: "maritalStatus", data: pending.data });
      await bot.api.sendMessage(chatId, "🎯 الحالة الاجتماعية المطلوبة:", { reply_markup: choiceMenu(MARITAL_CHOICES, 2, { skip: true }) });
      return;
    }
    await prisma.partnerPreference.update({
      where: { userId: tgUserId },
      data: { city: pending.data.city ?? null, maritalStatus: isSkip(text) ? null : text },
    });
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "✅ تم حفظ الفلاتر المتقدمة.", { reply_markup: mainMenu() });
    return;
  }

  if (pending?.mode === "superlike_note") {
    const target = await prisma.matchProfile.findUnique({ where: { userId: pending.targetUserId } });
    if (!target) {
      if (!(await resumeBrowsing(tgUserId, pending.resume))) await setPending(tgUserId, null);
      await bot.api.sendMessage(chatId, "لم يعد هذا الملف متاحاً.", { reply_markup: mainMenu() });
      return;
    }
    if (containsMatchBannedWords(text)) {
      await bot.api.sendMessage(chatId, "⚠️ هذه الرسالة تحتوي على محتوى غير مسموح به.");
      return;
    }
    const charge = await chargeSuperLike(tgUserId, pending.targetUserId, text);
    if (!charge.ok) {
      if (!(await resumeBrowsing(tgUserId, pending.resume))) await setPending(tgUserId, null);
      if (charge.reason === "insufficient") await bot.api.sendMessage(chatId, insufficientBalanceText(tgUserId, charge.needed, charge.balance), { reply_markup: mainMenu() });
      return;
    }
    const resumed = await resumeBrowsing(tgUserId, pending.resume);
    if (!resumed) await setPending(tgUserId, null);
    await notifyMutualLike(bot, tgUserId, pending.targetUserId);
    await bot.api.sendMessage(chatId, `⭐ تم إرسال إعجابك المميز مع رسالتك.${resumed ? "\n\nاضغط «➡️ الملف التالي» على البطاقة لمتابعة التصفح." : ""}`, { reply_markup: mainMenu() });
    return;
  }

  await bot.api.sendMessage(chatId, "اختر من القائمة.", { reply_markup: mainMenu() });
}

export async function cleanupExpiredFakeChats() {
  const users = await prisma.matchUser.findMany({
    where: { pendingAction: { path: ["mode"], equals: "fake_chatting" } },
  });
  const botTokens = new Map<string, string>();
  let cleaned = 0;
  for (const u of users) {
    const p = u.pendingAction as any;
    if (!p?.lastAt || Date.now() - p.lastAt < FAKE_CHAT_TIMEOUT_MS) continue;
    await prisma.matchUser.update({ where: { id: u.id }, data: { pendingAction: null as any } });
    let token = botTokens.get(u.botId);
    if (!token) {
      const botRow = await prisma.bot.findUnique({ where: { id: u.botId } });
      if (botRow) { token = botRow.token; botTokens.set(u.botId, token); }
    }
    if (token) {
      const bot = new TelegramBot(token);
      await bot.api.sendMessage(
        Number(u.id),
        "⚠️ غادر المستخدم الآخر المحادثة.\nاضغط «🔀 مراسلة عشوائية» للبحث من جديد.",
        { reply_markup: mainMenu() }
      ).catch(() => null);
    }
    cleaned++;
  }
  return cleaned;
}
