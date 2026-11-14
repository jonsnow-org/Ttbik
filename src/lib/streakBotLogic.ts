import { Bot as TelegramBot, Keyboard } from "grammy";
import { prisma } from "@/lib/prisma";
import type { Bot as BotRow } from "@prisma/client";
import { recordBotVisit, countBotVisitors } from "@/lib/botVisit";
import { startGuide } from "@/lib/botStartGuide";
import { formatBroadcastText, BROADCAST_COMPOSE_HINT } from "@/lib/utils";
import { earnPoints } from "@/lib/platformPoints";
import { MEMORIAL_BUTTON, MENU_BUTTON } from "@/lib/khatma/rules";
import { isServicesRequest } from "@/lib/servicesInTelegram";
import { APP_BUTTON } from "@/lib/botApp/buttons";
import { botAppUrl, setBotAppMenu } from "@/lib/builderOwnerBot";
import { gateUrl } from "@/lib/hostingOps";
import { InlineKeyboard } from "grammy";

import { MENU_BUTTON as CONTEST_BUTTON } from "@/lib/contests/rules";
import { contestStats, sendContestIntro } from "@/lib/contests/contests";
import { claimPrizes, PRIZE_START } from "@/lib/contests/prizes";
import {
  consumeKhatmaText, handleKhatmaPayment, handleSponsorStarsPayment, handleKhatmaPrivateCallback, khatmaStats, openMemorialFromStart, sendKhatmaIntro, startMemorialOrder, type KhatmaPending,
} from "@/lib/khatma/khatma";

/**
 * STREAK_BOT template (docs/claude-feature-backlog.md item 5) — daily-habit
 * streak tracker across a fixed set of categories. Each category keeps its
 * own running streak (StreakEntry), incremented by one "✅ سجلت اليوم"
 * check-in per day; missing a day resets that category's streak back to 1
 * on the next check-in. No AI, no payment, nothing user-generated.
 *
 * A brand-new, fully isolated template: no shared tables, no shared logic
 * files, no shared payment routes with any other bot on the platform.
 */

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_TELEGRAM_ID || "";
// The owner panel keeps its button as it was; it now opens the bot's own Mini App like every other entry.
const APP_TEXT = "📱 تطبيق البوت: سلاسلك اليومية، الختمة الجماعية ومسابقات الجروبات في مكان واحد.";
const SERVICES_BUTTON_ADMIN = "🧭 خدمات وأرباح";

/** This bot's own Mini App (src/app/bot-app, STREAK_BOT: daily chains + group khatma + group contests). */
export const appUrlFor = (botRow: BotRow, section?: "khatma" | "contests", params: Record<string, string> = {}) => botAppUrl(gateUrl(), botRow.id, section, params);
const appButton = (botRow: BotRow, label: string, section?: "khatma" | "contests") => new InlineKeyboard().webApp(label, appUrlFor(botRow, section));
// The menu button («التطبيق») of every chains bot opens its Mini App; set once per process, like the ads & earn bots.
const appMenuDone = new Set<string>();
async function ensureStreakAppMenu(botRow: BotRow): Promise<void> {
  if (appMenuDone.has(botRow.id)) return;
  const updated = await setBotAppMenu(botRow.token, gateUrl(), botRow.id).catch(() => false);
  if (updated) appMenuDone.add(botRow.id);
}

// ---------------------------------------------------------------------
// Category definitions — static list
// ---------------------------------------------------------------------
export type StreakCategory = { id: string; emoji: string; title: string; menuLabel: string };

export const STREAK_CATEGORIES: StreakCategory[] = [
  { id: "fasting", emoji: "🌙", title: "الصيام", menuLabel: "🌙 الصيام" },
  { id: "prayer", emoji: "🕌", title: "الصلاة", menuLabel: "🕌 الصلاة" },
  { id: "reading", emoji: "📖", title: "القراءة", menuLabel: "📖 القراءة" },
  { id: "exercise", emoji: "🏃", title: "الرياضة", menuLabel: "🏃 الرياضة" },
];

function findCategory(id: string): StreakCategory | undefined {
  return STREAK_CATEGORIES.find((c) => c.id === id);
}
function findCategoryByLabel(label: string): StreakCategory | undefined {
  return STREAK_CATEGORIES.find((c) => c.menuLabel === label);
}

// ---------------------------------------------------------------------
// Date helpers — plain "YYYY-MM-DD" (UTC), same convention already used
// elsewhere in this codebase (see src/lib/wordGame.ts, channelPublisher.ts).
// ---------------------------------------------------------------------
export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
export function yesterdayKey(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
type PendingAction =
  | { mode: "admin_broadcast" }
  | { mode: "admin_lookup" }
  | { mode: "admin_channel" }
  | KhatmaPending;

// ---------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------
function backLabel(): string {
  return "◀️ رجوع";
}
function isBack(text: string): boolean {
  return text === backLabel();
}
const TODAY_LABEL = "🌙 بطاقة اليوم";
const BOARD_BUTTON = "🧩 لوحة سلاسلي";
const ALL_BUTTON = "📊 كل سلاسلي";
const INFO_BUTTON = "ℹ️ معلومات";
const USER_PANEL_BUTTON = "👤 لوحة المستخدم";
const ADMIN_PANEL_BUTTON = "🛠 لوحة الإدارة";
const isOwnerId = (id: string) => !!SUPER_ADMIN_ID && id === SUPER_ADMIN_ID;

/** The user panel. Groups of two per row: board and totals, the four chains, the group features, app and info. The owner gets one extra row back to the admin panel. */
export function mainMenu(owner = false): Keyboard {
  const kb = new Keyboard();
  const items = [TODAY_LABEL, BOARD_BUTTON, ...STREAK_CATEGORIES.map((c) => c.menuLabel), ALL_BUTTON, MENU_BUTTON, MEMORIAL_BUTTON, CONTEST_BUTTON, APP_BUTTON, INFO_BUTTON];
  if (owner) items.push(ADMIN_PANEL_BUTTON);
  items.forEach((t, i) => { kb.text(t); if (i % 2 === 1) kb.row(); });
  return kb.resized();
}
function categoryMenu(): Keyboard {
  return new Keyboard()
    .text("✅ سجلت اليوم").row()
    .text("📤 مشاركة").text(backLabel())
    .resized();
}
/** The admin panel (owner only): management on top, then shortcuts into the user panel and the Mini App so the owner can see exactly what users see. */
export function adminMenu(): Keyboard {
  return new Keyboard()
    .text("📊 الإحصائيات").text("🔎 بحث عن مستخدم").row()
    .text("📢 بث جماعي").text("📡 قناة الاشتراك الإجباري").row()
    .text(USER_PANEL_BUTTON).text(APP_BUTTON).row()
    .text(SERVICES_BUTTON_ADMIN)
    .resized();
}

/** Texts of the user panel: the owner's admin panel hands them to the regular flow, so every user feature can be tried from the owner's account. */
export function isUserFlowText(text: string, pending: PendingAction | null): boolean {
  return (
    isServicesRequest(text) || isBack(text) ||
    [APP_BUTTON, "/app", MENU_BUTTON, MEMORIAL_BUTTON, CONTEST_BUTTON, "/khatma", "/contest", TODAY_LABEL, "/today", BOARD_BUTTON, "/widget", ALL_BUTTON, INFO_BUTTON, "✅ سجلت اليوم", "📤 مشاركة"].includes(text) ||
    !!findCategoryByLabel(text) ||
    /^\/start (app|k_|khatma|contest|prize)/.test(text) ||
    pending?.mode === "khatma_name" || pending?.mode === "khatma_dedication" || (pending as { mode?: string } | null)?.mode === "category"
  );
}

// ---------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------
// upsert, not findUnique-then-create — same race-avoidance reasoning as
// every other ensureXUser in this codebase (two near-simultaneous first
// messages from the same new user must never both pass an existence check).
export async function ensureStreakUser(botId: string, tgUserId: string) {
  return prisma.streakUser.upsert({ where: { id: tgUserId }, update: {}, create: { id: tgUserId, botId } });
}
async function setPending(userId: string, action: PendingAction | null) {
  await prisma.streakUser.update({ where: { id: userId }, data: { pendingAction: action as any } });
}
export async function getOrCreateEntry(userId: string, categoryId: string) {
  return prisma.streakEntry.upsert({
    where: { userId_category: { userId, category: categoryId } },
    update: {},
    create: { userId, category: categoryId },
  });
}

/** «✅ سجلت اليوم» for one category (chat and Mini App): once per UTC day; yesterday continues the streak, a gap restarts it at 1. */
export async function checkInCore(botId: string, userId: string, categoryId: string): Promise<{ already: boolean; continued: boolean; entry: { currentStreak: number; longestStreak: number; lastCheckInDate: string | null } }> {
  const entry = await getOrCreateEntry(userId, categoryId);
  const today = todayKey();
  if (entry.lastCheckInDate === today) return { already: true, continued: false, entry };
  const continued = entry.lastCheckInDate === yesterdayKey();
  const newStreak = continued ? entry.currentStreak + 1 : 1;
  const newLongest = Math.max(entry.longestStreak, newStreak);
  // Compare-and-swap on the last check-in day: a double tap (chat + app at once) counts one day only.
  const n = await prisma.streakEntry.updateMany({
    where: { userId, category: categoryId, lastCheckInDate: entry.lastCheckInDate },
    data: { currentStreak: newStreak, longestStreak: newLongest, lastCheckInDate: today },
  });
  if (n.count !== 1) {
    const fresh = await getOrCreateEntry(userId, categoryId);
    return { already: true, continued: false, entry: fresh };
  }
  await earnPoints(userId, 1, "streak_checkin", botId).catch(() => null);
  return { already: false, continued, entry: { currentStreak: newStreak, longestStreak: newLongest, lastCheckInDate: today } };
}

function entryStatusText(cat: StreakCategory, entry: { currentStreak: number; longestStreak: number; lastCheckInDate: string | null }): string {
  const checkedInToday = entry.lastCheckInDate === todayKey();
  const lines = [
    `${cat.emoji} ${cat.title}`,
    "",
    `🔥 سلسلتك الحالية: ${entry.currentStreak} يوم متتالي`,
    `🏆 أطول سلسلة: ${entry.longestStreak} يوم`,
    "",
    checkedInToday ? "✅ سجّلت اليوم بالفعل، عد غداً لتكمل سلسلتك!" : "لم تسجّل اليوم بعد — اضغط «✅ سجلت اليوم» للحفاظ على سلسلتك.",
  ];
  return lines.join("\n");
}

export function shareCardText(cat: StreakCategory, entry: { currentStreak: number }): string {
  return `🔥 سلسلتي في ${cat.title} ${cat.emoji}: ${entry.currentStreak} يوم متتالي!\n\nانضم إلي وابدأ سلسلتك الخاصة 💪`;
}

// ---------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------
async function sendAdminStats(bot: TelegramBot, botRow: BotRow, chatId: number) {
  const notAdmin = { id: { not: SUPER_ADMIN_ID || "__none__" } };
  const [ownUsers, activeStreaksCount, banned] = await Promise.all([
    prisma.streakUser.count({ where: { botId: botRow.id, ...notAdmin } }),
    prisma.streakEntry.count({ where: { currentStreak: { gt: 0 }, user: { botId: botRow.id, ...notAdmin } } }),
    prisma.streakUser.count({ where: { botId: botRow.id, isBanned: true } }),
  ]);
  const usersCount = await countBotVisitors(botRow.id, SUPER_ADMIN_ID, ownUsers);
  const k = await khatmaStats().catch(() => null);
  const c = await contestStats().catch(() => null);
  const contestLine = c ? `\n🏆 المسابقات: جولات ${c.rounds} · جروبات ${c.groups} · لاعبون ${c.players}` : "";
  const khatmaLine = k ? `\n\n📖 الختمات: مجموعات ${k.groups} · صدقة جارية ${k.memorials} · ختمات مكتملة ${k.rounds} · أجزاء مقروءة ${k.juzRead} · نجوم ${k.starsPaid}⭐` : "";
  await bot.api.sendMessage(
    chatId,
    `📊 إحصائيات بوت السلاسل اليومية\n\n👥 المستخدمون: ${usersCount}\n🚫 المحظورون: ${banned}\n🔥 سلاسل نشطة: ${activeStreaksCount}${khatmaLine}${contestLine}`
  );
}

async function handleStreakAdmin(bot: TelegramBot, botRow: BotRow, msg: any): Promise<boolean> {
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);
  if (!SUPER_ADMIN_ID || tgUserId !== SUPER_ADMIN_ID) return false;

  const text = String(msg.text || "").trim();
  const adminUser = await ensureStreakUser(botRow.id, tgUserId);
  const pending = adminUser.pendingAction as PendingAction | null;
  // Everything of the user panel goes to the regular flow (the owner can try every feature like any user).
  if (isUserFlowText(text, pending)) return false;
  if (text === USER_PANEL_BUTTON) {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, startGuide("STREAK"), { reply_markup: mainMenu(true) });
    return true;
  }
  if (text === "/admin" || text === ADMIN_PANEL_BUTTON) {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "🛠 لوحة تحكم بوت السلاسل اليومية.", { reply_markup: adminMenu() });
    return true;
  }

  if (text === "/start" || text.startsWith("/start ")) {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "🛠 لوحة تحكم بوت السلاسل اليومية.", { reply_markup: adminMenu() });
    return true;
  }
  if (pending?.mode === "admin_broadcast" && text) {
    await setPending(tgUserId, null);
    const recipients = await prisma.streakUser.findMany({ where: { id: { not: SUPER_ADMIN_ID } }, select: { id: true } });
    const messageText = formatBroadcastText(text);
    let sent = 0;
    for (const r of recipients) {
      try {
        await bot.api.sendMessage(Number(r.id), messageText);
        sent++;
      } catch {}
    }
    await bot.api.sendMessage(chatId, `✅ تم الإرسال إلى ${sent} من أصل ${recipients.length}.`);
    return true;
  }
  if (pending?.mode === "admin_lookup" && text) {
    await setPending(tgUserId, null);
    const targetId = text.replace(/[^0-9]/g, "");
    const user = await prisma.streakUser.findUnique({ where: { id: targetId }, include: { streaks: true } });
    if (!user) {
      await bot.api.sendMessage(chatId, "لم يتم العثور على مستخدم بهذا الآيدي.");
      return true;
    }
    const muted = user.mutedUntil && user.mutedUntil > new Date();
    const streakLines = user.streaks.length
      ? user.streaks.map((s) => `${findCategory(s.category)?.emoji || ""} ${findCategory(s.category)?.title || s.category}: ${s.currentStreak} يوم`).join("\n")
      : "لا توجد سلاسل بعد.";
    await bot.api.sendMessage(
      chatId,
      `🆔 ${targetId}\n🚫 محظور: ${user.isBanned ? "نعم" : "لا"}\n🔇 مكتوم: ${muted ? `نعم حتى ${user.mutedUntil!.toLocaleString("ar")}` : "لا"}\n\n${streakLines}\n\nلحظر/رفع الحظر أرسل: /ban ${targetId} أو /unban ${targetId}`
    );
    return true;
  }
  if (text.startsWith("/ban ") || text.startsWith("/unban ")) {
    const ban = text.startsWith("/ban ");
    const targetId = text.split(" ")[1]?.replace(/[^0-9]/g, "") || "";
    const target = await prisma.streakUser.findUnique({ where: { id: targetId } });
    if (!target) {
      await bot.api.sendMessage(chatId, "لم يتم العثور على مستخدم بهذا الآيدي.");
      return true;
    }
    await prisma.streakUser.update({ where: { id: targetId }, data: { isBanned: ban } });
    await bot.api
      .sendMessage(Number(targetId), ban ? "🚫 تم حظرك من استخدام هذا البوت من قِبل الإدارة." : "✅ تم رفع الحظر عنك من قِبل الإدارة، يمكنك استخدام البوت الآن.")
      .catch(() => null);
    await bot.api.sendMessage(chatId, ban ? "⛔ تم الحظر." : "🔓 تم رفع الحظر.");
    return true;
  }
  if (text === "📊 الإحصائيات") {
    await sendAdminStats(bot, botRow, chatId);
    return true;
  }
  if (text === "🔎 بحث عن مستخدم") {
    await setPending(tgUserId, { mode: "admin_lookup" });
    await bot.api.sendMessage(chatId, "أرسل آيدي المستخدم:");
    return true;
  }
  if (text === "📡 قناة الاشتراك الإجباري") {
    await setPending(tgUserId, { mode: "admin_channel" });
    await bot.api.sendMessage(chatId, "أرسل معرّف القناة (@channel)، أو اضغط تخطّي لإلغاء الاشتراط الحالي:", { reply_markup: new Keyboard().text("⏭ تخطّي").resized() });
    return true;
  }
  if (pending?.mode === "admin_channel" && text) {
    await setPending(tgUserId, null);
    const skip = text === "⏭ تخطّي";
    await prisma.bot.update({ where: { id: botRow.id }, data: { requiredChannel: skip ? null : text.replace(/^@/, "") } });
    await bot.api.sendMessage(chatId, skip ? "✅ تم إلغاء اشتراط الاشتراك الإجباري." : `✅ تم تعيين قناة الاشتراك الإجباري: @${text.replace(/^@/, "")}`);
    return true;
  }
  if (text === "📢 بث جماعي") {
    await setPending(tgUserId, { mode: "admin_broadcast" });
    await bot.api.sendMessage(chatId, `✍️ اكتب رسالة البث الجماعي — ستُرسل لجميع مستخدمي البوت:\n\n${BROADCAST_COMPOSE_HINT}`);
    return true;
  }
  // anything else the owner sends used to get no reply at all
  await bot.api.sendMessage(chatId, "🛠 اختر من لوحة التحكم بالأسفل.", { reply_markup: adminMenu() });
  return true; // super admin's own chat never falls through to the regular flow below
}

// ---------------------------------------------------------------------
// Regular flow
// ---------------------------------------------------------------------
export async function handleStreakBotUpdate(bot: TelegramBot, botRow: BotRow, update: any) {
  // 🧩 Bot API 10.4 widget tap («سجّلت اليوم» inside the chat bubble): dynamic import, the widget module imports this file.
  if (update.widget_query) {
    const { handleStreakWidgetQuery } = await import("@/lib/streakWidget");
    await handleStreakWidgetQuery(bot, botRow, update.widget_query);
    return;
  }
  // 📖 Khatma: inline buttons (memorial purchase, memorial board) and the Stars receipt come first.
  if (update.callback_query) {
    const cq = update.callback_query;
    const uid = String(cq.from?.id || "");
    if (uid) await ensureStreakUser(botRow.id, uid);
    if (/^(tq|tcc|tcp)(\||$)/.test(String(cq.data || ""))) {
      const { handleTodayCallback } = await import("@/lib/streakToday");
      await handleTodayCallback(bot, botRow, cq).catch(() => bot.api.answerCallbackQuery(cq.id).catch(() => null));
      return;
    }
    if (String(cq.data || "").startsWith("sk|")) {
      const { handleBoardTap } = await import("@/lib/streakWidget");
      await handleBoardTap(bot, botRow, cq).catch(() => bot.api.answerCallbackQuery(cq.id).catch(() => null));
      return;
    }
    const handled = await handleKhatmaPrivateCallback(bot, botRow, cq, (p) => setPending(uid, p));
    if (!handled) await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }
  if (update.message?.successful_payment) {
    if (await handleSponsorStarsPayment(bot, update.message)) return;
    await handleKhatmaPayment(bot, botRow, update.message);
    return;
  }
  const msg = update.message;
  if (!msg?.from || !msg.chat) return;
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);
  void ensureStreakAppMenu(botRow);

  if (await handleStreakAdmin(bot, botRow, msg)) return;

  const user = await ensureStreakUser(botRow.id, tgUserId);
  await prisma.streakUser.update({ where: { id: tgUserId }, data: { lastActiveAt: new Date() } }).catch(() => null);

  if (user.isBanned) {
    await bot.api.sendMessage(chatId, "🚫 تم حظرك من استخدام هذا البوت من قِبل الإدارة.");
    return;
  }
  if (user.mutedUntil && user.mutedUntil > new Date()) {
    await bot.api.sendMessage(chatId, "🔇 أنت مكتوم مؤقتاً. حاول لاحقاً.");
    return;
  }

  // Mandatory subscription channel gate (same pattern as AD_BOT/JOBS_BOT/CONFESSION_BOT/NAME_COMPAT_BOT/QUIZ_BOT).
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

  const text = String(msg.text || "").trim();
  if (!text) return;

  const pending = user.pendingAction as PendingAction | null;
  const activeCategory = pending && (pending as any).mode === "category" ? findCategory((pending as any).categoryId) : undefined;

  if (isBack(text)) {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "🏠 القائمة الرئيسية:", { reply_markup: mainMenu(isOwnerId(tgUserId)) });
    return;
  }

  if (pending && (pending.mode === "khatma_name" || pending.mode === "khatma_dedication") && !text.startsWith("/") && text !== MENU_BUTTON && text !== MEMORIAL_BUTTON) {
    if (await consumeKhatmaText(bot, botRow, chatId, tgUserId, text, pending, (p) => setPending(tgUserId, p))) return;
  }

  if (text === "/start" || text.startsWith("/start ")) {
    await recordBotVisit(botRow.id, tgUserId);
    await setPending(tgUserId, null);
    const payload = text.split(/\s+/)[1] || "";
    if (payload === "khatma") { await sendKhatmaIntro(bot, chatId, appUrlFor(botRow, "khatma")); return; }
    if (payload === "contest") { await sendContestIntro(bot, chatId, appUrlFor(botRow, "contests")); return; }
    if (payload === "app") { await bot.api.sendMessage(chatId, APP_TEXT, { reply_markup: appButton(botRow, APP_BUTTON) }); return; }
    if (payload === PRIZE_START) { await claimPrizes(bot, chatId, tgUserId); return; }
    if (payload && (await openMemorialFromStart(bot, botRow, chatId, payload))) return;
    await bot.api.sendMessage(
      chatId,
      startGuide("STREAK"),
      { reply_markup: mainMenu(isOwnerId(tgUserId)) }
    );
    return;
  }

  if (isServicesRequest(text) || text === APP_BUTTON || text === "/app") {
    await bot.api.sendMessage(chatId, APP_TEXT, { reply_markup: appButton(botRow, APP_BUTTON) });
    return;
  }
  if (text === MENU_BUTTON || text === "/khatma") {
    await setPending(tgUserId, null);
    await sendKhatmaIntro(bot, chatId, appUrlFor(botRow, "khatma"));
    return;
  }
  if (text === CONTEST_BUTTON || text === "/contest") {
    await setPending(tgUserId, null);
    await sendContestIntro(bot, chatId, appUrlFor(botRow, "contests"));
    return;
  }
  if (text === MEMORIAL_BUTTON) {
    await startMemorialOrder(bot, chatId, (p) => setPending(tgUserId, p));
    return;
  }

  const chosenCategory = findCategoryByLabel(text);
  if (chosenCategory) {
    await setPending(tgUserId, { mode: "category", categoryId: chosenCategory.id } as any);
    const entry = await getOrCreateEntry(tgUserId, chosenCategory.id);
    await bot.api.sendMessage(chatId, entryStatusText(chosenCategory, entry), { reply_markup: categoryMenu() });
    return;
  }

  if (activeCategory && text === "✅ سجلت اليوم") {
    const r = await checkInCore(botRow.id, tgUserId, activeCategory.id);
    if (r.already) {
      await bot.api.sendMessage(chatId, "✅ سجّلت اليوم بالفعل، عد غداً لتكمل سلسلتك!", { reply_markup: categoryMenu() });
      return;
    }
    await bot.api.sendMessage(
      chatId,
      `${r.continued ? "🔥" : "🌱"} تم التسجيل! سلسلتك الآن ${r.entry.currentStreak} يوم متتالي.`,
      { reply_markup: categoryMenu() }
    );
    return;
  }

  if (activeCategory && text === "📤 مشاركة") {
    const entry = await getOrCreateEntry(tgUserId, activeCategory.id);
    await bot.api.sendMessage(chatId, shareCardText(activeCategory, entry), { reply_markup: categoryMenu() });
    return;
  }

  if (text === TODAY_LABEL || text === "/today") {
    await setPending(tgUserId, null);
    const { sendToday } = await import("@/lib/streakToday");
    await sendToday(bot, chatId, tgUserId);
    return;
  }

  if (text === BOARD_BUTTON) {
    await setPending(tgUserId, null);
    const { sendBoard } = await import("@/lib/streakWidget");
    await sendBoard(bot, chatId, tgUserId);
    return;
  }
  // Experimental Bot API 10.4 widget (private chat only). Telegram's own refusal reason is shown to the owner, never to users.
  if (text === "/widget") {
    await setPending(tgUserId, null);
    const { sendStreakWidget, sendBoard, probeWidgets } = await import("@/lib/streakWidget");
    const why = await sendStreakWidget(bot, chatId, tgUserId);
    if (why) {
      if (SUPER_ADMIN_ID && tgUserId === SUPER_ADMIN_ID) {
        const probe = await probeWidgets(bot, chatId, tgUserId);
        await bot.api.sendMessage(chatId, `⚙️ رفض تيليجرام إرسال الأداة التفاعلية:\n${why}\n\nفحص تدريجي (من الأصغر للأكبر):\n${probe.join("\n")}`);
      }
      else await bot.api.sendMessage(chatId, "الأداة التفاعلية غير متاحة لحسابك بعد؛ هذه لوحتك العادية:");
      await sendBoard(bot, chatId, tgUserId);
    }
    return;
  }

  if (text === ALL_BUTTON) {
    await setPending(tgUserId, null);
    const entries = await prisma.streakEntry.findMany({ where: { userId: tgUserId } });
    if (entries.length === 0) {
      await bot.api.sendMessage(chatId, "😔 لم تبدأ أي سلسلة بعد. اختر تصنيفاً من القائمة للبدء.", { reply_markup: mainMenu(isOwnerId(tgUserId)) });
      return;
    }
    const lines = entries
      .map((e) => {
        const cat = findCategory(e.category) || (e.category === "quiz" ? { emoji: "🧠", title: "سؤال اليوم" } : undefined);
        return `${cat?.emoji || ""} ${cat?.title || e.category}: 🔥 ${e.currentStreak} يوم (أطول: ${e.longestStreak})`;
      })
      .join("\n");
    await bot.api.sendMessage(chatId, `📊 كل سلاسلك:\n\n${lines}`, { reply_markup: mainMenu(isOwnerId(tgUserId)) });
    return;
  }

  if (text === INFO_BUTTON) {
    const me = await bot.api.getMe();
    const info =
      `ℹ️ بوت السلاسل اليومية\n\n` +
      `بوت لتتبع عاداتك اليومية!\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `🔥 كيف يعمل:\n` +
      `• اختر تصنيفاً من القائمة الرئيسية.\n` +
      `• اضغط «✅ سجلت اليوم» كل يوم للحفاظ على سلسلتك.\n` +
      `• فوات يوم واحد بدون تسجيل يعيد السلسلة إلى الصفر.\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📊 كل سلاسلي:\n` +
      `• شاهد كل سلاسلك الحالية وأطولها في مكان واحد.\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📤 المشاركة:\n` +
      `• شارك بطاقة سلسلتك مع أصدقائك لتحفيزهم!\n\n` +
      `📲 شارك البوت: https://t.me/${me.username}`;
    await bot.api.sendMessage(chatId, info, { reply_markup: mainMenu(isOwnerId(tgUserId)) });
    return;
  }

  await bot.api.sendMessage(chatId, "لم أفهم طلبك، اختر من القائمة:", { reply_markup: mainMenu(isOwnerId(tgUserId)) });
}
