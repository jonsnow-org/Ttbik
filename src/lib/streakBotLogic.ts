import { Bot as TelegramBot, Keyboard } from "grammy";
import { prisma } from "@/lib/prisma";
import type { Bot as BotRow } from "@prisma/client";
import { recordBotVisit } from "@/lib/botVisit";
import { formatBroadcastText, BROADCAST_COMPOSE_HINT } from "@/lib/utils";
import { earnPoints } from "@/lib/platformPoints";

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

// ---------------------------------------------------------------------
// Category definitions — static list
// ---------------------------------------------------------------------
type StreakCategory = { id: string; emoji: string; title: string; menuLabel: string };

const STREAK_CATEGORIES: StreakCategory[] = [
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
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
function yesterdayKey(): string {
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
  | { mode: "admin_channel" };

// ---------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------
function backLabel(): string {
  return "◀️ رجوع";
}
function isBack(text: string): boolean {
  return text === backLabel();
}
function mainMenu(): Keyboard {
  const kb = new Keyboard();
  for (const cat of STREAK_CATEGORIES) kb.text(cat.menuLabel).row();
  kb.text("📊 كل سلاسلي").text("ℹ️ معلومات");
  return kb.resized();
}
function categoryMenu(): Keyboard {
  return new Keyboard()
    .text("✅ سجلت اليوم").row()
    .text("📤 مشاركة").text(backLabel())
    .resized();
}
function adminMenu(): Keyboard {
  return new Keyboard()
    .text("📊 الإحصائيات").text("🔎 بحث عن مستخدم").row()
    .text("📡 قناة الاشتراك الإجباري").text("📢 بث جماعي")
    .resized();
}

// ---------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------
// upsert, not findUnique-then-create — same race-avoidance reasoning as
// every other ensureXUser in this codebase (two near-simultaneous first
// messages from the same new user must never both pass an existence check).
async function ensureStreakUser(botId: string, tgUserId: string) {
  return prisma.streakUser.upsert({ where: { id: tgUserId }, update: {}, create: { id: tgUserId, botId } });
}
async function setPending(userId: string, action: PendingAction | null) {
  await prisma.streakUser.update({ where: { id: userId }, data: { pendingAction: action as any } });
}
async function getOrCreateEntry(userId: string, categoryId: string) {
  return prisma.streakEntry.upsert({
    where: { userId_category: { userId, category: categoryId } },
    update: {},
    create: { userId, category: categoryId },
  });
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

function shareCardText(cat: StreakCategory, entry: { currentStreak: number }): string {
  return `🔥 سلسلتي في ${cat.title} ${cat.emoji}: ${entry.currentStreak} يوم متتالي!\n\nانضم إلي وابدأ سلسلتك الخاصة 💪`;
}

// ---------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------
async function sendAdminStats(bot: TelegramBot, chatId: number) {
  const [usersCount, activeStreaksCount] = await Promise.all([
    prisma.streakUser.count(),
    prisma.streakEntry.count({ where: { currentStreak: { gt: 0 } } }),
  ]);
  await bot.api.sendMessage(
    chatId,
    `📊 إحصائيات بوت السلاسل اليومية\n\n👥 المستخدمون: ${usersCount}\n🔥 سلاسل نشطة: ${activeStreaksCount}`
  );
}

async function handleStreakAdmin(bot: TelegramBot, botRow: BotRow, msg: any): Promise<boolean> {
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);
  if (!SUPER_ADMIN_ID || tgUserId !== SUPER_ADMIN_ID) return false;

  const text = String(msg.text || "").trim();
  const adminUser = await ensureStreakUser(botRow.id, tgUserId);
  const pending = adminUser.pendingAction as PendingAction | null;

  if (text === "/start") {
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
    await sendAdminStats(bot, chatId);
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
  const msg = update.message;
  if (!msg?.from || !msg.chat) return;
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);

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
    await bot.api.sendMessage(chatId, "🏠 القائمة الرئيسية:", { reply_markup: mainMenu() });
    return;
  }

  if (text === "/start") {
    await recordBotVisit(botRow.id, tgUserId);
    await setPending(tgUserId, null);
    await bot.api.sendMessage(
      chatId,
      "👋 أهلاً بك في بوت السلاسل اليومية!\n\nاختر تصنيفاً من القائمة وابدأ تسجيل عادتك اليومية — كل يوم متتالٍ يزيد سلسلتك، وكل انقطاع يعيدها من جديد. حافظ عليها وشاركها مع أصدقائك!",
      { reply_markup: mainMenu() }
    );
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
    const entry = await getOrCreateEntry(tgUserId, activeCategory.id);
    const today = todayKey();
    if (entry.lastCheckInDate === today) {
      await bot.api.sendMessage(chatId, "✅ سجّلت اليوم بالفعل، عد غداً لتكمل سلسلتك!", { reply_markup: categoryMenu() });
      return;
    }
    const continued = entry.lastCheckInDate === yesterdayKey();
    const newStreak = continued ? entry.currentStreak + 1 : 1;
    const newLongest = Math.max(entry.longestStreak, newStreak);
    const updated = await prisma.streakEntry.update({
      where: { userId_category: { userId: tgUserId, category: activeCategory.id } },
      data: { currentStreak: newStreak, longestStreak: newLongest, lastCheckInDate: today },
    });
    await bot.api.sendMessage(
      chatId,
      `${continued ? "🔥" : "🌱"} تم التسجيل! سلسلتك الآن ${updated.currentStreak} يوم متتالي.`,
      { reply_markup: categoryMenu() }
    );
    await earnPoints(tgUserId, 1, "streak_checkin", botRow.id).catch(() => null);
    return;
  }

  if (activeCategory && text === "📤 مشاركة") {
    const entry = await getOrCreateEntry(tgUserId, activeCategory.id);
    await bot.api.sendMessage(chatId, shareCardText(activeCategory, entry), { reply_markup: categoryMenu() });
    return;
  }

  if (text === "📊 كل سلاسلي") {
    await setPending(tgUserId, null);
    const entries = await prisma.streakEntry.findMany({ where: { userId: tgUserId } });
    if (entries.length === 0) {
      await bot.api.sendMessage(chatId, "😔 لم تبدأ أي سلسلة بعد. اختر تصنيفاً من القائمة للبدء.", { reply_markup: mainMenu() });
      return;
    }
    const lines = entries
      .map((e) => {
        const cat = findCategory(e.category);
        return `${cat?.emoji || ""} ${cat?.title || e.category}: 🔥 ${e.currentStreak} يوم (أطول: ${e.longestStreak})`;
      })
      .join("\n");
    await bot.api.sendMessage(chatId, `📊 كل سلاسلك:\n\n${lines}`, { reply_markup: mainMenu() });
    return;
  }

  if (text === "ℹ️ معلومات") {
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
    await bot.api.sendMessage(chatId, info, { reply_markup: mainMenu() });
    return;
  }

  await bot.api.sendMessage(chatId, "لم أفهم طلبك، اختر من القائمة:", { reply_markup: mainMenu() });
}
