import { Bot as TelegramBot, Keyboard, InlineKeyboard } from "grammy";
import { prisma } from "@/lib/prisma";
import type { Bot as BotRow, MatchProfile, MatchUser, PartnerPreference } from "@prisma/client";
import { getMasterHotWalletAddress, isNativeTonConfigured } from "@/services/ton-service";
import { getOrCreateMatchTonMemo } from "@/services/marriageTonService";
import { askNovaAssist, improveListingText, novaAssistConfigured } from "@/lib/novaAssist";

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
const RANDOM_CHAT_WINDOW_SECONDS = 60;
const SKIP_COOLDOWN_HOURS = 24;
const ONLINE_THRESHOLD_MINUTES = 5;
const CONTACT_REQUEST_THRESHOLD = 15; // messages exchanged before offering the formal-contact-request button

// Paid feature pricing (owner spec, 2026-09-05) — USD-equivalent, charged
// from MatchUser.balance (see the MARRIAGE_BOT ledger). All one-time
// purchases are permanent unlocks except Boost (24h) and VIP (30 days).
const PRICE_BOOST_24H = 2;
const PRICE_VERIFIED_BADGE = 3;
const PRICE_EXTRA_PHOTOS = 2;
const PRICE_PROFILE_VISITORS = 2;
const PRICE_ADVANCED_FILTERS = 2;
const PRICE_SUPER_LIKE = 1;
const PRICE_VIP_30D = 8;
const VIP_DAYS = 30;

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
function containsMatchBannedWords(text: string): boolean {
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
  | { mode: "search_browsing"; queue: string[]; index: number }
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
  | { mode: "superlike_note"; targetUserId: string };

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
function upgradesMenu(): Keyboard {
  const kb = new Keyboard().text("💰 رصيدي وإيداع").row();
  if (isNativeTonConfigured()) kb.text("🔷 إيداع TON / USDT مباشر").row();
  return kb
    .text(`🚀 رفع ملفي ($${PRICE_BOOST_24H}/24س)`).row()
    .text(`☑️ طلب التوثيق ($${PRICE_VERIFIED_BADGE})`).row()
    .text(`🖼 صور إضافية ($${PRICE_EXTRA_PHOTOS})`).row()
    .text(`👀 من زار ملفي ($${PRICE_PROFILE_VISITORS})`).row()
    .text(`🎯 فلاتر متقدمة ($${PRICE_ADVANCED_FILTERS})`).row()
    .text(`👑 العضوية الذهبية ($${PRICE_VIP_30D}/شهر)`).row()
    .text("🕶 وضع التخفي (ضمن الذهبية)").row()
    .text(backLabel())
    .resized();
}
function infoMenu(): Keyboard {
  const kb = new Keyboard().text("📩 مراسلة الأدمن").text("🔗 دعوة رابط البوت").row();
  if (novaAssistConfigured()) kb.text("✨ اسأل نوفا (ذكاء اصطناعي)").row();
  return kb.text(backLabel()).resized();
}
function adminMenu(): Keyboard {
  return new Keyboard()
    .text("📊 الإحصائيات").text("📋 الملفات المعلقة").row()
    .text("🚩 بلاغات المطابقة").text("🚩 بلاغات الدردشة العشوائية").row()
    .text("📢 بث جماعي").text("🔎 بحث عن مستخدم").row()
    .text("🔓 رفع حظر/كتم").text("📥 الرسائل الواردة")
    .resized();
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
function skipMenu(): Keyboard {
  return new Keyboard().text(SKIP_LABEL).row().text(backLabel()).resized();
}
function plainBackMenu(): Keyboard {
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
  return new Keyboard().text("⏹ إنهاء المحادثة").text("⛔ حظر").row().text("🚩 إبلاغ").resized();
}
function isBack(text: string): boolean {
  return text === backLabel();
}
function isSkip(text: string): boolean {
  return text === SKIP_LABEL;
}

async function setPending(userId: string, action: PendingAction | null) {
  await prisma.matchUser.update({ where: { id: userId }, data: { pendingAction: action as any } });
}

async function ensureMatchUser(botId: string, tgUserId: string, referredBy?: string) {
  const existing = await prisma.matchUser.findUnique({ where: { id: tgUserId } });
  if (existing) return existing;
  return prisma.matchUser.create({ data: { id: tgUserId, botId, referredBy: referredBy && referredBy !== tgUserId ? referredBy : null } });
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
function isVipActive(user: Pick<MatchUser, "vipUntil">): boolean {
  return !!user.vipUntil && user.vipUntil > new Date();
}
function hasAdvancedFilters(user: Pick<MatchUser, "advancedFiltersUnlocked" | "vipUntil">): boolean {
  return user.advancedFiltersUnlocked || isVipActive(user);
}
function hasProfileVisitors(user: Pick<MatchUser, "profileVisitorsUnlocked" | "vipUntil">): boolean {
  return user.profileVisitorsUnlocked || isVipActive(user);
}
function isEffectivelyBoosted(profile: Pick<MatchProfile, "boostedUntil">, user: Pick<MatchUser, "vipUntil">): boolean {
  return (!!profile.boostedUntil && profile.boostedUntil > new Date()) || isVipActive(user);
}

function depositLink(userId: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
  return `${base}/pay/marriage?uid=${userId}`;
}
function insufficientBalanceText(userId: string, needed: number, have: number): string {
  return `❌ رصيدك الحالي $${have.toFixed(2)} لا يكفي (المطلوب $${needed.toFixed(2)}). أودِع من هنا:\n${depositLink(userId)}`;
}

// Deducts `amount` from the user's MARRIAGE_BOT balance and logs a
// MatchTransaction — atomically, so a crash between the two is
// impossible. Returns ok:false (charging nothing) if the balance is too
// low; the caller is responsible for showing insufficientBalanceText.
async function chargeMatchUser(userId: string, amount: number, type: string): Promise<{ ok: boolean; balance: number }> {
  const user = await prisma.matchUser.findUnique({ where: { id: userId } });
  const balance = Number(user?.balance || 0);
  if (balance < amount) return { ok: false, balance };
  await prisma.$transaction([
    prisma.matchUser.update({ where: { id: userId }, data: { balance: { decrement: amount } } }),
    prisma.matchTransaction.create({ data: { userId, amount, currency: "internal", type, status: "COMPLETED" } }),
  ]);
  return { ok: true, balance: balance - amount };
}

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
      await bot.api.sendMessage(chatId, "أرسل دولتك:", { reply_markup: plainBackMenu() });
      break;
    case "job":
      await bot.api.sendMessage(chatId, "أرسل عملك:", { reply_markup: skipMenu() });
      break;
    case "education":
      await bot.api.sendMessage(chatId, "أرسل مستواك التعليمي:", { reply_markup: skipMenu() });
      break;
    case "attributes":
      await bot.api.sendMessage(chatId, "أرسل وصفاً موجزاً لمواصفاتك (الطول، اللون، إلخ):", { reply_markup: skipMenu() });
      break;
    case "city":
      await bot.api.sendMessage(chatId, "أرسل مدينة سكنك (اختياري):", { reply_markup: skipMenu() });
      break;
    case "maritalStatus":
      await bot.api.sendMessage(chatId, "أرسل حالتك الاجتماعية (أعزب/مطلق/أرمل...) (اختياري):", { reply_markup: skipMenu() });
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
    status: "PENDING",
  };
  await prisma.matchProfile.upsert({
    where: { userId },
    update: { ...shared, ...(data.photoFileId ? { photoFileId: data.photoFileId } : {}), ...(data.voiceFileId ? { voiceFileId: data.voiceFileId } : {}) },
    create: { userId, ...shared, photoFileId: data.photoFileId ?? null, voiceFileId: data.voiceFileId ?? null },
  });
  await setPending(userId, null);
  await bot.api.sendMessage(
    chatId,
    "✅ تم حفظ ملفك الشخصي، وهو الآن قيد المراجعة من إدارة البوت. سيصلك إشعار فور اعتماده.",
    { reply_markup: mainMenu() }
  );
  if (SUPER_ADMIN_ID) {
    const profile = await prisma.matchProfile.findUnique({ where: { userId } });
    if (profile) await notifyAdminNewProfile(bot, profile);
  }
}

async function notifyAdminNewProfile(bot: TelegramBot, profile: MatchProfile) {
  // Buttons carry the full userId in callback_data — see handleAdminCallback.
  // The text commands (موافقة ملف/رفض ملف <رمز>) still work too, as a
  // fallback for whenever a message with buttons has scrolled out of view.
  const text =
    (profile.status === "PENDING" ? `👤 ملف بانتظار المراجعة` : `👤 ملف`) + ` #${shortId(profile.userId)}\n\n` +
    `الاسم: ${profile.name}\nالجنس: ${profile.gender === "MALE" ? "ذكر" : "أنثى"}\nالعمر: ${profile.age}\nالدولة: ${profile.country}\n` +
    `العمل: ${profile.job || "غير محدد"}\nالتعليم: ${profile.education || "غير محدد"}\nالمواصفات: ${profile.attributes || "غير محدد"}\n` +
    `التواصل: ${profile.contactMethod === "TELEGRAM" ? "تلجرام" : "واتساب"} — ${profile.contactValue}`;
  const kb = new InlineKeyboard().text("✅ قبول", `madmin_approve|${profile.userId}`).text("❌ رفض", `madmin_reject|${profile.userId}`);
  try {
    if (profile.photoFileId) {
      await bot.api.sendPhoto(Number(SUPER_ADMIN_ID), profile.photoFileId, { caption: text, reply_markup: kb });
    } else {
      await bot.api.sendMessage(Number(SUPER_ADMIN_ID), text, { reply_markup: kb });
    }
    // Admin review is always the one context that sees the real photo
    // directly (the consent-gating on sendSearchCard is for other members
    // browsing search results, not for moderation) — same for the voice
    // intro, so the admin can actually judge it before approving.
    if (profile.voiceFileId) {
      await bot.api.sendVoice(Number(SUPER_ADMIN_ID), profile.voiceFileId).catch(() => null);
    }
  } catch {
    // admin unreachable — not fatal, they can still review later once they message the bot
  }
}

async function consumeProfileStep(bot: TelegramBot, chatId: number, userId: string, pending: Extract<PendingAction, { mode: "profile_wizard" }>, text: string) {
  const { step, data } = pending;
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
      await bot.api.sendMessage(chatId, `💍 مواصفات الشريك الذي تبحث عنه\n\nما الدولة التي يفضّل ${you} أن يكون منها الشريك؟`, { reply_markup: plainBackMenu() });
      break;
    case "ageMin":
      await bot.api.sendMessage(chatId, "الحد الأدنى للعمر المطلوب:", { reply_markup: skipMenu() });
      break;
    case "ageMax":
      await bot.api.sendMessage(chatId, "الحد الأقصى للعمر المطلوب:", { reply_markup: skipMenu() });
      break;
    case "job":
      await bot.api.sendMessage(chatId, `ما العمل الذي ${you === "أنتِ" ? "تفضّلينه" : "تفضّله"} في الشريك؟`, { reply_markup: skipMenu() });
      break;
    case "education":
      await bot.api.sendMessage(chatId, "المستوى التعليمي المطلوب:", { reply_markup: skipMenu() });
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

async function buildSearchQueue(botId: string, selfId: string, selfProfile: MatchProfile, selfPref: PartnerPreference): Promise<string[]> {
  const oppositeGender: Gender = selfProfile.gender === "MALE" ? "FEMALE" : "MALE";
  const sameCountry = selfPref.country.trim().toLowerCase() === selfProfile.country.trim().toLowerCase();

  const candidates = await prisma.matchProfile.findMany({
    where: { status: "APPROVED", isHidden: false, gender: oppositeGender, userId: { not: selfId }, user: { botId } },
    include: { user: true },
    take: 200,
  });

  const blocks = await prisma.matchBlock.findMany({ where: { OR: [{ blockerId: selfId }, { blockedId: selfId }] } });
  const blockedIds = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]).filter((id) => id !== selfId));

  const selfUser = await prisma.matchUser.findUnique({ where: { id: selfId } });
  const useAdvancedFilters = selfUser ? hasAdvancedFilters(selfUser) : false;

  const filtered: typeof candidates = [];
  for (const c of candidates) {
    if (blockedIds.has(c.userId)) continue;
    if (c.country.trim().toLowerCase() !== selfPref.country.trim().toLowerCase()) continue;
    if (!ageInRange(c.age, selfPref.ageMin, selfPref.ageMax)) continue;
    if (!looseMatch(c.job, selfPref.job)) continue;
    if (!looseMatch(c.education, selfPref.education)) continue;
    if (!looseMatch(c.attributes, selfPref.attributes)) continue;
    // Advanced filters (paid, owner spec, 2026-09-05) — only applied if
    // the searcher has unlocked them; harmless no-op otherwise since
    // looseMatch(x, null) always passes.
    if (useAdvancedFilters) {
      if (!looseMatch(c.city, selfPref.city)) continue;
      if (!looseMatch(c.maritalStatus, selfPref.maritalStatus)) continue;
    }

    if (!sameCountry) {
      // Cross-country: mutual match — the candidate's own preference must
      // also accept self (owner spec, 2026-09-02).
      const theirPref = await prisma.partnerPreference.findUnique({ where: { userId: c.userId } });
      if (!theirPref) continue;
      if (theirPref.country.trim().toLowerCase() !== selfProfile.country.trim().toLowerCase()) continue;
      if (!ageInRange(selfProfile.age, theirPref.ageMin, theirPref.ageMax)) continue;
      if (!looseMatch(selfProfile.job, theirPref.job)) continue;
      if (!looseMatch(selfProfile.education, theirPref.education)) continue;
      if (!looseMatch(selfProfile.attributes, theirPref.attributes)) continue;
    }
    filtered.push(c);
  }

  // Profile Boost (paid, owner spec, 2026-09-05) — boosted profiles sort
  // first, within the already-matched/filtered set (never bypasses the
  // actual matching rules above, just re-orders who's seen first among
  // equally-eligible candidates).
  filtered.sort((a, b) => (isEffectivelyBoosted(b, b.user) ? 1 : 0) - (isEffectivelyBoosted(a, a.user) ? 1 : 0));

  return filtered.slice(0, 20).map((c) => c.userId);
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

async function sendSearchCard(bot: TelegramBot, chatId: number, targetUserId: string, viewerId: string) {
  const [profile, targetUser, likeCount, reportsReceived, photoPermission, viewer] = await Promise.all([
    prisma.matchProfile.findUnique({ where: { userId: targetUserId } }),
    prisma.matchUser.findUnique({ where: { id: targetUserId } }),
    prisma.matchLike.count({ where: { toUserId: targetUserId } }),
    prisma.matchReport.count({ where: { targetId: targetUserId } }),
    prisma.matchPhotoPermission.findUnique({ where: { ownerId_viewerId: { ownerId: targetUserId, viewerId } } }),
    prisma.matchUser.findUnique({ where: { id: viewerId }, include: { profile: true } }),
  ]);
  if (!profile || !targetUser) return false;

  const lines = [
    `👤 ${profile.name}، ${profile.age}${profile.verificationStatus === "VERIFIED" ? " ☑️" : ""}`,
    `🌍 ${profile.country}`,
    profile.job ? `💼 ${profile.job}` : null,
    profile.education ? `🎓 ${profile.education}` : null,
    profile.attributes ? `📝 ${profile.attributes}` : null,
    profile.city ? `🏙 ${profile.city}` : null,
    profile.maritalStatus ? `💍 ${profile.maritalStatus}` : null,
    presenceLabel(targetUser.lastActiveAt),
    seriousnessLabel(computeSeriousnessScore(profile, targetUser, reportsReceived)),
    isEffectivelyBoosted(profile, targetUser) ? "🚀 ملف مرفوع" : null,
  ].filter((l): l is string => !!l);

  // Callback data carries the full Telegram ID, not a shortId suffix — a
  // 6-char suffix of a plain numeric Telegram ID (unlike a UUID) has real
  // collision risk between different users; the full ID easily fits
  // Telegram's 64-byte callback_data limit anyway.
  const kb = new InlineKeyboard();
  kb.text(likeButtonLabel(likeCount), `mlike|${targetUserId}`).text(`⭐ سوبر لايك`, `msuperlike|${targetUserId}`).row();
  const contactUrl = profile.contactMethod === "TELEGRAM" ? `https://t.me/${profile.contactValue.replace(/^@/, "")}` : `https://wa.me/${profile.contactValue.replace(/[^0-9]/g, "")}`;
  kb.url("💬 رسالة", contactUrl).row();
  kb.text("➡️ التالي", "mnext").row();
  kb.text("🚩 إبلاغ", `mreport|${targetUserId}`).text("⛔ حظر", `mblock|${targetUserId}`);

  const text = lines.join("\n");
  const photoGranted = photoPermission?.status === "GRANTED";
  if (profile.photoFileId && photoGranted) {
    await bot.api.sendPhoto(chatId, profile.photoFileId, { caption: text, reply_markup: kb });
  } else if (profile.photoFileId) {
    // Photo access is consent-gated (owner spec, 2026-09-05): the real
    // photo is never sent until the profile owner explicitly grants this
    // specific viewer permission (see the mphotoreq/mphotoyes/mphotono
    // callbacks). Stronger privacy than a cosmetic blur — nothing leaks
    // at all pre-consent, not even a blurred silhouette.
    kb.row().text("🔒 اطلب رؤية الصورة", `mphotoreq|${targetUserId}`);
    await bot.api.sendMessage(chatId, `🔒 (الصورة مخفية — اطلب إذن صاحب الملف لعرضها)\n\n${text}`, { reply_markup: kb });
  } else {
    await bot.api.sendMessage(chatId, `📷 (بلا صورة)\n\n${text}`, { reply_markup: kb });
  }
  if (profile.voiceFileId) {
    await bot.api.sendVoice(chatId, profile.voiceFileId).catch(() => null);
  }
  // Extra photos (paid, owner spec, 2026-09-05) — sent as follow-up
  // messages, only once the main photo is actually visible to this
  // viewer (showing them while the main photo is still consent-gated
  // would defeat the whole point of the gate).
  if (photoGranted) {
    if (profile.photoFileId2) await bot.api.sendPhoto(chatId, profile.photoFileId2).catch(() => null);
    if (profile.photoFileId3) await bot.api.sendPhoto(chatId, profile.photoFileId3).catch(() => null);
  }

  // Profile Visitors tracking (paid, owner spec, 2026-09-05) — skipped
  // entirely when the VIEWER has incognito active (their own activity,
  // not the profile owner's, is what incognito hides).
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
  return true;
}

async function advanceSearch(bot: TelegramBot, chatId: number, userId: string, pending: Extract<PendingAction, { mode: "search_browsing" }>) {
  let idx = pending.index;
  while (idx < pending.queue.length) {
    const targetId = pending.queue[idx];
    const stillBlocked = await isMutuallyBlocked(userId, targetId);
    const stillApproved = await prisma.matchProfile.findUnique({ where: { userId: targetId }, select: { status: true } });
    if (!stillBlocked && stillApproved?.status === "APPROVED") {
      const sent = await sendSearchCard(bot, chatId, targetId, userId);
      if (sent) {
        await setPending(userId, { mode: "search_browsing", queue: pending.queue, index: idx + 1 });
        return;
      }
    }
    idx++;
  }
  await setPending(userId, null);
  await bot.api.sendMessage(chatId, "🔚 لا يوجد المزيد من النتائج المطابقة حالياً.", { reply_markup: mainMenu() });
}

async function startSearch(bot: TelegramBot, chatId: number, userId: string, botId: string) {
  const [profile, pref] = await Promise.all([
    prisma.matchProfile.findUnique({ where: { userId } }),
    prisma.partnerPreference.findUnique({ where: { userId } }),
  ]);
  if (!profile || profile.status !== "APPROVED") {
    await bot.api.sendMessage(chatId, "⚠️ يجب إنشاء ملفك الشخصي واعتماده من الإدارة أولاً.", { reply_markup: mainMenu() });
    return;
  }
  if (!pref) {
    await bot.api.sendMessage(chatId, "⚠️ يجب تحديد مواصفات الشريك الذي تبحث عنه أولاً.", { reply_markup: mainMenu() });
    return;
  }
  const queue = await buildSearchQueue(botId, userId, profile, pref);
  if (queue.length === 0) {
    await bot.api.sendMessage(chatId, "😔 لا توجد نتائج مطابقة حالياً.", { reply_markup: mainMenu() });
    return;
  }
  await advanceSearch(bot, chatId, userId, { mode: "search_browsing", queue, index: 0 });
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
      await prisma.matchLike.upsert({
        where: { fromUserId_toUserId: { fromUserId: tgUserId, toUserId: target.userId } },
        update: {},
        create: { fromUserId: tgUserId, toUserId: target.userId },
      }).catch(() => null);
      const count = await prisma.matchLike.count({ where: { toUserId: target.userId } });
      const kb = InlineKeyboard.from(cq.message.reply_markup.inline_keyboard);
      kb.inline_keyboard[0][0].text = likeButtonLabel(count);
      await bot.api.editMessageReplyMarkup(chatId, messageId, { reply_markup: kb }).catch(() => null);
    }
    await bot.api.answerCallbackQuery(cq.id, { text: "❤️ تم الإعجاب" }).catch(() => null);
    return;
  }
  if (data === "mnext") {
    if (pending?.mode === "search_browsing") {
      await advanceSearch(bot, chatId, tgUserId, pending);
    }
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (data.startsWith("mreport|")) {
    const targetId = data.split("|")[1];
    const target = await prisma.matchProfile.findUnique({ where: { userId: targetId } });
    if (target) {
      await prisma.matchReport.create({ data: { reporterId: tgUserId, targetId: target.userId, source: "SEARCH" } }).catch(() => null);
      if (SUPER_ADMIN_ID) {
        await bot.api.sendMessage(Number(SUPER_ADMIN_ID), `🚩 بلاغ جديد على ملف #${shortId(target.userId)} (${target.name}) من المستخدم ${tgUserId}.\nراجعه من «🚩 بلاغات المطابقة».`).catch(() => null);
      }
    }
    await bot.api.answerCallbackQuery(cq.id, { text: "🚩 تم إرسال بلاغك" }).catch(() => null);
    return;
  }
  if (data.startsWith("msuperlike|")) {
    const targetId = data.split("|")[1];
    await setPending(tgUserId, { mode: "superlike_note", targetUserId: targetId });
    await bot.api
      .sendMessage(chatId, `⭐ اكتب رسالة قصيرة ترافق إعجابك (سيُخصم $${PRICE_SUPER_LIKE} من رصيدك):`, { reply_markup: plainBackMenu() })
      .catch(() => null);
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
        await bot.api.sendPhoto(Number(viewerId), profile.photoFileId, { caption: "🔓 تم منحك إذن مشاهدة الصورة." }).catch(() => null);
      }
    } else {
      await bot.api.sendMessage(Number(viewerId), "❌ لم يوافق صاحب الملف على مشاركة صورته.").catch(() => null);
    }
    await bot.api.answerCallbackQuery(cq.id, { text: approve ? "✅ تم السماح" : "تم الرفض" }).catch(() => null);
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
    const session = await prisma.randomChatSession.findUnique({ where: { id: pending.sessionId } });
    if (!session || session.status !== "ACTIVE") {
      await bot.api.answerCallbackQuery(cq.id, { text: "انتهت هذه المحادثة." }).catch(() => null);
      return;
    }
    if (!session.contactRequestedBy) {
      await prisma.randomChatSession.update({ where: { id: session.id }, data: { contactRequestedBy: tgUserId } }).catch(() => null);
      await bot.api
        .sendMessage(Number(pending.partnerId), "📇 يرغب الطرف الآخر بتبادل بيانات التواصل الرسمي معك. إن وافقت، اضغط الزر:", {
          reply_markup: new InlineKeyboard().text("✅ أوافق على التبادل", "mcontact"),
        })
        .catch(() => null);
      await bot.api.answerCallbackQuery(cq.id, { text: "تم إرسال الطلب، بانتظار موافقة الطرف الآخر" }).catch(() => null);
    } else if (session.contactRequestedBy === tgUserId) {
      await bot.api.answerCallbackQuery(cq.id, { text: "طلبك قيد الانتظار بالفعل" }).catch(() => null);
    } else {
      await revealContacts(bot, tgUserId, pending.partnerId);
      await bot.api.answerCallbackQuery(cq.id, { text: "✅ تم تبادل بيانات التواصل" }).catch(() => null);
    }
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
      await advanceSearch(bot, chatId, tgUserId, pending);
    }
    return;
  }
  await bot.api.answerCallbackQuery(cq.id).catch(() => null);
}

// ---------------------------------------------------------------------
// Random anonymous chat
// ---------------------------------------------------------------------
async function findWaitingPartner(botId: string, selfId: string) {
  const now = new Date();
  const waiting = await prisma.randomChatQueue.findMany({
    where: { botId, status: "WAITING", expiresAt: { gt: now }, userId: { not: selfId } },
    orderBy: { created_at: "asc" },
    take: 50,
  });
  for (const w of waiting) {
    if (await isMutuallyBlocked(selfId, w.userId)) continue;
    const recentSession = await prisma.randomChatSession.findFirst({
      where: {
        OR: [
          { user1Id: selfId, user2Id: w.userId },
          { user1Id: w.userId, user2Id: selfId },
        ],
        created_at: { gt: new Date(Date.now() - SKIP_COOLDOWN_HOURS * 3600 * 1000) },
      },
    });
    if (recentSession) continue;
    return w;
  }
  return null;
}

async function startRandomChat(bot: TelegramBot, chatId: number, botRow: BotRow, tgUserId: string) {
  const partnerEntry = await findWaitingPartner(botRow.id, tgUserId);
  if (partnerEntry) {
    const session = await prisma.randomChatSession.create({ data: { user1Id: tgUserId, user2Id: partnerEntry.userId, botId: botRow.id } });
    await prisma.randomChatQueue.update({ where: { id: partnerEntry.id }, data: { status: "MATCHED", sessionId: session.id } });
    await setPending(tgUserId, { mode: "random_chatting", sessionId: session.id, partnerId: partnerEntry.userId });
    await setPending(partnerEntry.userId, { mode: "random_chatting", sessionId: session.id, partnerId: tgUserId });
    await bot.api.sendMessage(chatId, "✅ تم الاتصال! ابدأ الدردشة الآن (مجهولة الهوية بالكامل).", { reply_markup: randomChatMenu() });
    await bot.api.sendMessage(Number(partnerEntry.userId), "✅ تم الاتصال! ابدأ الدردشة الآن (مجهولة الهوية بالكامل).", { reply_markup: randomChatMenu() }).catch(() => null);
    return;
  }
  await prisma.randomChatQueue.create({
    data: { userId: tgUserId, botId: botRow.id, status: "WAITING", expiresAt: new Date(Date.now() + RANDOM_CHAT_WINDOW_SECONDS * 1000) },
  });
  await setPending(tgUserId, { mode: "random_waiting" });
  await animateSearchingMessage(bot, chatId);
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

// Respectful exit system (owner spec, 2026-09-05) — ending a random chat
// used to just vanish on the other side with a bare "انتهت المحادثة."
// Now the leaving side picks a short polite reason first (see
// exitReasonKeyboard below) and the partner gets a proper closing message
// instead of an abrupt cutoff. The reason is optional (a plain "⛔ حظر" or
// the global back-button escape hatch still end instantly without one).
const EXIT_REASON_LABELS: Record<string, string> = {
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
async function revealContacts(bot: TelegramBot, userA: string, userB: string) {
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

async function endRandomChat(bot: TelegramBot, tgUserId: string, sessionId: string, partnerId: string, reason: "end" | "block", exitReasonLabel?: string) {
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
  await bot.api.sendMessage(Number(tgUserId), "انتهت المحادثة.", { reply_markup: mainMenu() }).catch(() => null);
  await bot.api.sendMessage(Number(partnerId), partnerText, { reply_markup: mainMenu() }).catch(() => null);
}

// ---------------------------------------------------------------------
// SUPER_ADMIN moderation (text commands, same convention as adBotLogic)
// ---------------------------------------------------------------------
async function applyProfileDecision(bot: TelegramBot, adminChatId: number, profile: MatchProfile, approve: boolean) {
  await prisma.matchProfile.update({ where: { userId: profile.userId }, data: { status: approve ? "APPROVED" : "REJECTED" } });
  await bot.api.sendMessage(adminChatId, approve ? `✅ تم اعتماد ملف ${profile.name}.` : `❌ تم رفض ملف ${profile.name}.`);
  await bot.api
    .sendMessage(
      Number(profile.userId),
      approve ? "✅ تم اعتماد ملفك الشخصي! يمكنك الآن استخدام «🔍 البحث عن شريك»." : "❌ لم تتم الموافقة على ملفك الشخصي. راجع بياناتك من «👤 ملفي الشخصي» وحاول مجدداً."
    )
    .catch(() => null);

  // Referral reward (owner spec, 2026-09-05) — 24h free Boost for the
  // referrer, granted exactly once per referred person, only on a real
  // approval (never on rejection).
  if (approve) {
    const referredUser = await prisma.matchUser.findUnique({ where: { id: profile.userId } });
    if (referredUser?.referredBy && !referredUser.referralRewardGranted) {
      await prisma.matchUser.update({ where: { id: profile.userId }, data: { referralRewardGranted: true } }).catch(() => null);
      const boostUntil = new Date(Date.now() + 24 * 3600 * 1000);
      await prisma.matchProfile
        .update({ where: { userId: referredUser.referredBy }, data: { boostedUntil: boostUntil } })
        .catch(() => null);
      await bot.api
        .sendMessage(Number(referredUser.referredBy), "🎁 اعتمدت الإدارة ملف صديق دعوته! حصلت على رفع مجاني لملفك لمدة 24 ساعة.")
        .catch(() => null);
    }
  }
}

async function decideProfile(bot: TelegramBot, chatId: number, idSuffix: string, approve: boolean) {
  const candidates = await prisma.matchProfile.findMany({ where: { status: "PENDING" }, take: 200 });
  const profile = candidates.find((p) => shortId(p.userId) === idSuffix);
  if (!profile) {
    await bot.api.sendMessage(chatId, "الملف غير موجود أو رُوجع مسبقاً.");
    return;
  }
  await applyProfileDecision(bot, chatId, profile, approve);
}

async function decideProfileByUserId(bot: TelegramBot, chatId: number, userId: string, approve: boolean) {
  const profile = await prisma.matchProfile.findUnique({ where: { userId } });
  if (!profile || profile.status !== "PENDING") {
    await bot.api.sendMessage(chatId, "الملف غير موجود أو رُوجع مسبقاً.");
    return;
  }
  await applyProfileDecision(bot, chatId, profile, approve);
}

async function sendAdminStats(bot: TelegramBot, chatId: number) {
  const onlineSince = new Date(Date.now() - ONLINE_THRESHOLD_MINUTES * 60000);
  // The SUPER_ADMIN also gets a MatchUser row (purely to store their own
  // pendingAction state for the broadcast/lookup/unban flows below) — it
  // must never count as a real platform user in these stats.
  const notAdmin = { id: { not: SUPER_ADMIN_ID || "__none__" } };
  const [totalUsers, onlineUsers, pendingProfiles, approvedProfiles, rejectedProfiles, pendingSearchReports, pendingChatReports, activeSessions, waitingQueue, pendingInbox] = await Promise.all([
    prisma.matchUser.count({ where: notAdmin }),
    prisma.matchUser.count({ where: { ...notAdmin, lastActiveAt: { gte: onlineSince } } }),
    prisma.matchProfile.count({ where: { status: "PENDING" } }),
    prisma.matchProfile.count({ where: { status: "APPROVED" } }),
    prisma.matchProfile.count({ where: { status: "REJECTED" } }),
    prisma.matchReport.count({ where: { status: "PENDING", source: "SEARCH" } }),
    prisma.matchReport.count({ where: { status: "PENDING", source: "RANDOM_CHAT" } }),
    prisma.randomChatSession.count({ where: { status: "ACTIVE" } }),
    prisma.randomChatQueue.count({ where: { status: "WAITING", expiresAt: { gt: new Date() } } }),
    prisma.adminMessage.count({ where: { status: "PENDING" } }),
  ]);
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

async function runBroadcast(bot: TelegramBot, chatId: number, text: string) {
  const recipients = await prisma.matchUser.findMany({
    where: { phoneVerified: true, isBanned: false, id: { not: SUPER_ADMIN_ID || "__none__" } },
    select: { id: true },
  });
  let sent = 0;
  for (const r of recipients) {
    try {
      await bot.api.sendMessage(Number(r.id), `📢 إعلان من إدارة البوت:\n\n${text}`);
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

async function runUnban(bot: TelegramBot, chatId: number, rawId: string) {
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
  await bot.api.sendMessage(chatId, `✅ تم رفع الحظر/الكتم عن المستخدم ${targetId}.`);
  await bot.api.sendMessage(Number(targetId), "✅ تم رفع الحظر/الكتم عنك من قِبل الإدارة، يمكنك استخدام البوت الآن.").catch(() => null);
}

async function handleAdminMessage(bot: TelegramBot, chatId: number, text: string, adminId: string) {
  if (text === "/start") {
    await bot.api.sendMessage(chatId, "🛠 لوحة تحكم مشرف بوت التعارف والزواج.", { reply_markup: adminMenu() });
    return;
  }
  if (text === "📊 الإحصائيات") {
    await sendAdminStats(bot, chatId);
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
    await bot.api.sendMessage(chatId, "📢 أرسل نص الرسالة التي تريد بثّها لجميع المستخدمين المُفعّلين. لإلغاء العملية اضغط أي زر آخر من القائمة.");
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
  await bot.api.sendMessage(chatId, "🛠 لوحة تحكم مشرف بوت التعارف والزواج.", { reply_markup: adminMenu() });
}

async function handleAdminCallback(bot: TelegramBot, botId: string, chatId: number, data: string, cq: any) {
  if (data.startsWith("mverify_yes|") || data.startsWith("mverify_no|")) {
    const targetId = data.split("|")[1];
    const approve = data.startsWith("mverify_yes|");
    await prisma.matchProfile
      .update({ where: { userId: targetId }, data: { verificationStatus: approve ? "VERIFIED" : "REJECTED" } })
      .catch(() => null);
    await bot.api
      .sendMessage(
        Number(targetId),
        approve ? "☑️ تم توثيق ملفك! ستظهر الشارة بجانب اسمك في نتائج البحث." : "❌ لم يتم قبول طلب التوثيق. رسم المراجعة غير قابل للاسترجاع."
      )
      .catch(() => null);
    await bot.api.answerCallbackQuery(cq.id, { text: approve ? "✅ تم التوثيق" : "❌ تم الرفض" }).catch(() => null);
    return;
  }
  if (data.startsWith("madmin_approve|") || data.startsWith("madmin_reject|")) {
    const approve = data.startsWith("madmin_approve|");
    const userId = data.split("|")[1];
    await decideProfileByUserId(bot, chatId, userId, approve);
    await bot.api.answerCallbackQuery(cq.id, { text: approve ? "✅ تم القبول" : "❌ تم الرفض" }).catch(() => null);
    return;
  }
  if (data.startsWith("madmin_msgread|")) {
    const msgId = data.split("|")[1];
    await prisma.adminMessage.update({ where: { id: msgId }, data: { status: "READ" } }).catch(() => null);
    await bot.api.answerCallbackQuery(cq.id, { text: "✅ تم التحديد كمقروء" }).catch(() => null);
    return;
  }
  if (data.startsWith("madmin_msgban|") || data.startsWith("madmin_msgmute|")) {
    const msgId = data.split("|")[1];
    const inboxMsg = await prisma.adminMessage.findUnique({ where: { id: msgId } });
    if (!inboxMsg) {
      await bot.api.answerCallbackQuery(cq.id, { text: "الرسالة غير موجودة." }).catch(() => null);
      return;
    }
    if (data.startsWith("madmin_msgban|")) {
      await prisma.matchUser.update({ where: { id: inboxMsg.senderId }, data: { isBanned: true } }).catch(() => null);
      await bot.api.sendMessage(chatId, "⛔ تم حظر المستخدم نهائياً من البوت لتجاوزه التحذير.");
    } else {
      await prisma.matchUser.update({ where: { id: inboxMsg.senderId }, data: { mutedUntil: new Date(Date.now() + 24 * 3600 * 1000) } }).catch(() => null);
      await bot.api.sendMessage(chatId, "🔇 تم كتم المستخدم لمدة 24 ساعة.");
    }
    await prisma.adminMessage.update({ where: { id: msgId }, data: { status: "READ" } }).catch(() => null);
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
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
    const report = await prisma.matchReport.findUnique({ where: { id: reportId } });
    if (!report) {
      await bot.api.answerCallbackQuery(cq.id, { text: "البلاغ غير موجود." }).catch(() => null);
      return;
    }
    if (report.status === "REVIEWED") {
      await bot.api.answerCallbackQuery(cq.id, { text: "تمت مراجعة هذا البلاغ مسبقاً." }).catch(() => null);
      return;
    }
    await prisma.matchReport.update({ where: { id: reportId }, data: { status: "REVIEWED" } });
    if (action === "mrep_ban") {
      await prisma.matchUser.update({ where: { id: report.targetId }, data: { isBanned: true } }).catch(() => null);
      await bot.api.sendMessage(chatId, "⛔ تم حظر المستخدم المُبلَّغ عنه نهائياً من البوت.");
    } else if (action === "mrep_mute") {
      await prisma.matchUser.update({ where: { id: report.targetId }, data: { mutedUntil: new Date(Date.now() + 24 * 3600 * 1000) } }).catch(() => null);
      await bot.api.sendMessage(chatId, "🔇 تم كتم المستخدم لمدة 24 ساعة.");
    } else {
      await bot.api.sendMessage(chatId, "🙈 تم تجاهل البلاغ.");
    }
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  await bot.api.answerCallbackQuery(cq.id).catch(() => null);
}

// ---------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------
export async function handleMarriageBotUpdate(bot: TelegramBot, botRow: BotRow, update: any) {
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
        await bot.api.sendMessage(Number(adminPending.targetUserId), `↩️ رد من الإدارة:\n\n${text}`).catch(() => null);
        await prisma.adminMessage.update({ where: { id: adminPending.messageId }, data: { status: "READ" } }).catch(() => null);
        await bot.api.sendMessage(chatId, "✅ تم إرسال ردك إلى المستخدم.");
        return;
      }
    }
    if (adminPending) await setPending(tgUserId, null);
    await handleAdminMessage(bot, chatId, text, tgUserId);
    return;
  }

  // Referral capture (owner spec, 2026-09-05) — only meaningful on a
  // brand-new user's very first /start; ensureMatchUser only writes
  // referredBy on creation, never overwrites an existing row.
  const refMatch = typeof msg.text === "string" ? msg.text.match(/^\/start(?:@\w+)?\s+ref_(\d+)/) : null;
  const user = await ensureMatchUser(botRow.id, tgUserId, refMatch?.[1]);
  await prisma.matchUser.update({ where: { id: tgUserId }, data: { lastActiveAt: new Date() } }).catch(() => null);

  if (user.isBanned) {
    await bot.api.sendMessage(chatId, "🚫 تم حظرك من استخدام هذا البوت من قِبل الإدارة.");
    return;
  }
  if (user.mutedUntil && user.mutedUntil > new Date()) {
    await bot.api.sendMessage(chatId, "🔇 أنت مكتوم مؤقتاً بسبب مخالفة بلّغ عنها أحد المستخدمين. حاول لاحقاً.");
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
    await bot.api.sendMessage(chatId, "أهلاً بك 👋", { reply_markup: mainMenu() });
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
      await prisma.matchReport.create({ data: { reporterId: tgUserId, targetId: pending.partnerId, source: "RANDOM_CHAT" } }).catch(() => null);
      if (SUPER_ADMIN_ID) {
        await bot.api.sendMessage(Number(SUPER_ADMIN_ID), `🚩 بلاغ من محادثة عشوائية — المُبلِّغ ${tgUserId} ضد ${pending.partnerId}.\nراجعه من «🚩 بلاغات الدردشة العشوائية».`).catch(() => null);
      }
      await bot.api.sendMessage(chatId, "🚩 تم إرسال بلاغك.");
      return;
    }
    if (containsMatchBannedWords(text)) {
      await bot.api.sendMessage(chatId, "⚠️ هذه الرسالة تحتوي على محتوى غير مسموح به ولم يتم إرسالها.").catch(() => null);
      return;
    }
    await bot.api.sendMessage(Number(pending.partnerId), text).catch(() => null);

    const updatedSession = await prisma.randomChatSession
      .update({ where: { id: pending.sessionId }, data: { messageCount: { increment: 1 } } })
      .catch(() => null);
    if (updatedSession && !updatedSession.contactOfferSent && updatedSession.messageCount >= CONTACT_REQUEST_THRESHOLD) {
      await prisma.randomChatSession.update({ where: { id: pending.sessionId }, data: { contactOfferSent: true } }).catch(() => null);
      const offerKb = new InlineKeyboard().text("📇 طلب تبادل التواصل الرسمي", "mcontact");
      const offerText = "💬 المحادثة مستمرة بشكل جيد. عند الرغبة، يمكنكما طلب تبادل بيانات التواصل الرسمي لمتابعة الأمر بجدية أكبر:";
      await bot.api.sendMessage(chatId, offerText, { reply_markup: offerKb }).catch(() => null);
      await bot.api.sendMessage(Number(pending.partnerId), offerText, { reply_markup: offerKb }).catch(() => null);
    }
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
    const infoText = `👤 ملفك الشخصي\n\nالاسم: ${profile.name}\nالعمر: ${profile.age}\nالدولة: ${profile.country}\nالحالة: ${statusLabel}\nالظهور: ${visibilityLabel}\n\nلتعديل الملف أرسل «✏️ تعديل».`;
    const kb = new Keyboard().text("✏️ تعديل").text(toggleLabel).row().text("🗑 حذف ملفي نهائياً").row().text(backLabel()).resized();
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
  if (text === "🔀 مراسلة عشوائية") {
    await startRandomChat(bot, chatId, botRow, tgUserId);
    return;
  }
  if (text === "💌 من أعجب بي") {
    await showLikedBy(bot, chatId, tgUserId);
    return;
  }
  if (text === "ℹ️ معلومات") {
    await bot.api.sendMessage(
      chatId,
      "ℹ️ عن هذا البوت\n\n" +
        "🤖 بوت تعارف وزواج شرعي يعمل بخوارزمية مطابقة ذكية تحلّل ملفك الشخصي ومواصفات الشريك الذي تبحث عنه لإيجاد الأنسب لك تلقائياً.\n" +
        "🟢 البوت متصل الآن ويعمل على مدار الساعة.\n\n" +
        "📌 طريقة الاستخدام:\n" +
        "1️⃣ أنشئ ملفك الشخصي من «👤 ملفي الشخصي»\n" +
        "2️⃣ حدد مواصفات الشريك الذي تبحث عنه من «💍 مواصفات الشريك»\n" +
        "3️⃣ اضغط «🔍 البحث عن شريك» لعرض الملفات المطابقة\n" +
        "4️⃣ أو جرّب «🔀 مراسلة عشوائية» للتعارف المجهول الفوري\n\n" +
        "🔒 خصوصيتك محفوظة: لا تُشارَك بياناتك مع أي طرف حتى تختار أنت بدء التواصل.\n" +
        "🛡 كل ملف جديد يخضع لمراجعة يدوية من الإدارة قبل ظهوره في نتائج البحث.",
      { reply_markup: infoMenu() }
    );
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
    await bot.api.sendMessage(chatId, "⭐ الترقيات والمزايا المدفوعة — اختر ما يناسبك:", { reply_markup: upgradesMenu() });
    return;
  }
  if (text === "💰 رصيدي وإيداع") {
    const u = await prisma.matchUser.findUnique({ where: { id: tgUserId } });
    const balance = Number(u?.balance || 0);
    await bot.api.sendMessage(chatId, `💰 رصيدك الحالي: $${balance.toFixed(2)}\n\nللإيداع، افتح الرابط التالي:\n${depositLink(tgUserId)}`, { reply_markup: upgradesMenu() });
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
  if (text === `🚀 رفع ملفي ($${PRICE_BOOST_24H}/24س)`) {
    const profile = await prisma.matchProfile.findUnique({ where: { userId: tgUserId } });
    if (!profile) {
      await bot.api.sendMessage(chatId, "⚠️ يجب إنشاء ملفك الشخصي أولاً.", { reply_markup: upgradesMenu() });
      return;
    }
    const dbUser = await prisma.matchUser.findUnique({ where: { id: tgUserId } });
    if (dbUser && isVipActive(dbUser)) {
      await bot.api.sendMessage(
        chatId,
        "✨ اشتراكك الذهبي (VIP) يشمل رفعاً مستمراً لملفك بالفعل — لا حاجة لشراء رفع إضافي.",
        { reply_markup: upgradesMenu() }
      );
      return;
    }
    const charge = await chargeMatchUser(tgUserId, PRICE_BOOST_24H, "BOOST");
    if (!charge.ok) {
      await bot.api.sendMessage(chatId, insufficientBalanceText(tgUserId, PRICE_BOOST_24H, charge.balance), { reply_markup: upgradesMenu() });
      return;
    }
    const boostedUntil = new Date(Date.now() + 24 * 3600 * 1000);
    await prisma.matchProfile.update({ where: { userId: tgUserId }, data: { boostedUntil } });
    await bot.api.sendMessage(chatId, `🚀 تم رفع ملفك! سيظهر أولاً في نتائج البحث حتى ${boostedUntil.toLocaleString("ar")}.`, { reply_markup: upgradesMenu() });
    return;
  }
  if (text === `☑️ طلب التوثيق ($${PRICE_VERIFIED_BADGE})`) {
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
  if (text === `🖼 صور إضافية ($${PRICE_EXTRA_PHOTOS})`) {
    const profile = await prisma.matchProfile.findUnique({ where: { userId: tgUserId } });
    if (!profile) {
      await bot.api.sendMessage(chatId, "⚠️ يجب إنشاء ملفك الشخصي أولاً.", { reply_markup: upgradesMenu() });
      return;
    }
    const dbUser = await prisma.matchUser.findUnique({ where: { id: tgUserId } });
    if (!dbUser?.extraPhotosUnlocked && !(dbUser && isVipActive(dbUser))) {
      const charge = await chargeMatchUser(tgUserId, PRICE_EXTRA_PHOTOS, "EXTRA_PHOTOS");
      if (!charge.ok) {
        await bot.api.sendMessage(chatId, insufficientBalanceText(tgUserId, PRICE_EXTRA_PHOTOS, charge.balance), { reply_markup: upgradesMenu() });
        return;
      }
      await prisma.matchUser.update({ where: { id: tgUserId }, data: { extraPhotosUnlocked: true } });
    }
    const slot: 2 | 3 | null = !profile.photoFileId2 ? 2 : !profile.photoFileId3 ? 3 : null;
    if (!slot) {
      await bot.api.sendMessage(chatId, "لديك بالفعل الحد الأقصى من الصور (3).", { reply_markup: upgradesMenu() });
      return;
    }
    await setPending(tgUserId, { mode: "extra_photo_upload", slot });
    await bot.api.sendMessage(chatId, "🖼 أرسل الصورة الإضافية الآن:", { reply_markup: plainBackMenu() });
    return;
  }
  if (text === `👀 من زار ملفي ($${PRICE_PROFILE_VISITORS})`) {
    const dbUser = await prisma.matchUser.findUnique({ where: { id: tgUserId } });
    if (!dbUser) return;
    if (!hasProfileVisitors(dbUser)) {
      const charge = await chargeMatchUser(tgUserId, PRICE_PROFILE_VISITORS, "PROFILE_VISITORS");
      if (!charge.ok) {
        await bot.api.sendMessage(chatId, insufficientBalanceText(tgUserId, PRICE_PROFILE_VISITORS, charge.balance), { reply_markup: upgradesMenu() });
        return;
      }
      await prisma.matchUser.update({ where: { id: tgUserId }, data: { profileVisitorsUnlocked: true } });
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
  if (text === `🎯 فلاتر متقدمة ($${PRICE_ADVANCED_FILTERS})`) {
    const pref = await prisma.partnerPreference.findUnique({ where: { userId: tgUserId } });
    if (!pref) {
      await bot.api.sendMessage(chatId, "⚠️ يجب تحديد «💍 مواصفات الشريك» الأساسية أولاً.", { reply_markup: upgradesMenu() });
      return;
    }
    const dbUser = await prisma.matchUser.findUnique({ where: { id: tgUserId } });
    if (!dbUser) return;
    if (!hasAdvancedFilters(dbUser)) {
      const charge = await chargeMatchUser(tgUserId, PRICE_ADVANCED_FILTERS, "ADVANCED_FILTERS");
      if (!charge.ok) {
        await bot.api.sendMessage(chatId, insufficientBalanceText(tgUserId, PRICE_ADVANCED_FILTERS, charge.balance), { reply_markup: upgradesMenu() });
        return;
      }
      await prisma.matchUser.update({ where: { id: tgUserId }, data: { advancedFiltersUnlocked: true } });
    }
    await setPending(tgUserId, { mode: "advanced_filter_wizard", step: "city", data: {} });
    await bot.api.sendMessage(chatId, "🎯 المدينة المطلوبة للشريك:", { reply_markup: skipMenu() });
    return;
  }
  if (text === `👑 العضوية الذهبية ($${PRICE_VIP_30D}/شهر)`) {
    const charge = await chargeMatchUser(tgUserId, PRICE_VIP_30D, "VIP_MEMBERSHIP");
    if (!charge.ok) {
      await bot.api.sendMessage(chatId, insufficientBalanceText(tgUserId, PRICE_VIP_30D, charge.balance), { reply_markup: upgradesMenu() });
      return;
    }
    const dbUser = await prisma.matchUser.findUnique({ where: { id: tgUserId } });
    const base = dbUser?.vipUntil && dbUser.vipUntil > new Date() ? dbUser.vipUntil : new Date();
    const vipUntil = new Date(base.getTime() + VIP_DAYS * 24 * 3600 * 1000);
    await prisma.matchUser.update({ where: { id: tgUserId }, data: { vipUntil } });
    await bot.api.sendMessage(
      chatId,
      `👑 تم تفعيل العضوية الذهبية حتى ${vipUntil.toLocaleString("ar")}!\nتشمل: رفع مستمر للملف، فلاتر متقدمة، من زار ملفي، ووضع التخفي.`,
      { reply_markup: upgradesMenu() }
    );
    return;
  }
  if (text === "🕶 وضع التخفي (ضمن الذهبية)") {
    const dbUser = await prisma.matchUser.findUnique({ where: { id: tgUserId } });
    if (!dbUser || !isVipActive(dbUser)) {
      await bot.api.sendMessage(chatId, "🕶 وضع التخفي متاح فقط للأعضاء الذهبيين. فعّل «👑 العضوية الذهبية» أولاً.", { reply_markup: upgradesMenu() });
      return;
    }
    const profile = await prisma.matchProfile.findUnique({ where: { userId: tgUserId } });
    if (!profile) {
      await bot.api.sendMessage(chatId, "⚠️ يجب إنشاء ملفك الشخصي أولاً.", { reply_markup: upgradesMenu() });
      return;
    }
    const newState = !profile.isIncognito;
    await prisma.matchProfile.update({ where: { userId: tgUserId }, data: { isIncognito: newState } });
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
    if (pending.step === "city") {
      pending.data.city = isSkip(text) ? null : text;
      await setPending(tgUserId, { mode: "advanced_filter_wizard", step: "maritalStatus", data: pending.data });
      await bot.api.sendMessage(chatId, "🎯 الحالة الاجتماعية المطلوبة (أعزب/مطلق/أرمل...):", { reply_markup: skipMenu() });
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
      await setPending(tgUserId, null);
      await bot.api.sendMessage(chatId, "لم يعد هذا الملف متاحاً.", { reply_markup: mainMenu() });
      return;
    }
    if (containsMatchBannedWords(text)) {
      await bot.api.sendMessage(chatId, "⚠️ هذه الرسالة تحتوي على محتوى غير مسموح به.");
      return;
    }
    const charge = await chargeMatchUser(tgUserId, PRICE_SUPER_LIKE, "SUPER_LIKE");
    if (!charge.ok) {
      await setPending(tgUserId, null);
      await bot.api.sendMessage(chatId, insufficientBalanceText(tgUserId, PRICE_SUPER_LIKE, charge.balance), { reply_markup: mainMenu() });
      return;
    }
    await prisma.matchLike
      .upsert({
        where: { fromUserId_toUserId: { fromUserId: tgUserId, toUserId: pending.targetUserId } },
        update: { note: text },
        create: { fromUserId: tgUserId, toUserId: pending.targetUserId, note: text },
      })
      .catch(() => null);
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "⭐ تم إرسال إعجابك المميز مع رسالتك.", { reply_markup: mainMenu() });
    return;
  }

  await bot.api.sendMessage(chatId, "اختر من القائمة.", { reply_markup: mainMenu() });
}
