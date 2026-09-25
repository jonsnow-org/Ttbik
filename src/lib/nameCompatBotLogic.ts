import crypto from "crypto";
import { Bot as TelegramBot, Keyboard } from "grammy";
import { prisma } from "@/lib/prisma";
import type { Bot as BotRow } from "@prisma/client";
import { recordBotVisit } from "@/lib/botVisit";
import { formatBroadcastText, BROADCAST_COMPOSE_HINT } from "@/lib/utils";
import { earnPoints } from "@/lib/platformPoints";

/**
 * NAME_COMPAT_BOT template (docs/claude-feature-backlog.md item 3) — send
 * two names, get a deterministic "نسبة التوافق" (compatibility %) back as
 * a shareable result card. No AI, no payment, no randomness: the same two
 * names always produce the same percentage (see computeCompatibility()),
 * regardless of the order they're sent in.
 *
 * A brand-new, fully isolated template: no shared tables, no shared logic
 * files, no shared payment routes with any other bot on the platform.
 */

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_TELEGRAM_ID || "";
const HISTORY_PAGE_SIZE = 5;

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
type PendingAction =
  | { mode: "awaiting_name1" }
  | { mode: "awaiting_name2"; name1: string }
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
  return new Keyboard()
    .text("💞 احسب نسبة التوافق").text("📜 آخر نتائجي").row()
    .text("ℹ️ معلومات")
    .resized();
}
function plainBackMenu(): Keyboard {
  return new Keyboard().text(backLabel()).resized();
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
async function ensureNameCompatUser(botId: string, tgUserId: string) {
  return prisma.nameCompatUser.upsert({ where: { id: tgUserId }, update: {}, create: { id: tgUserId, botId } });
}
async function setPending(userId: string, action: PendingAction | null) {
  await prisma.nameCompatUser.update({ where: { id: userId }, data: { pendingAction: action as any } });
}

function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

// Deterministic, symmetric (order-independent) 0-100 compatibility score:
// a plain sha256 hash of the two normalized names sorted together — no
// randomness, no AI, same pair always gives the same number back.
function computeCompatibility(rawName1: string, rawName2: string): number {
  const pair = [normalizeName(rawName1), normalizeName(rawName2)].sort().join("|");
  const hash = crypto.createHash("sha256").update(pair).digest();
  return hash.readUInt32BE(0) % 101; // 0-100 inclusive
}

function compatibilityBar(pct: number): string {
  const filled = Math.round(pct / 10);
  return "🟩".repeat(filled) + "⬜".repeat(10 - filled);
}

function compatibilityVerdict(pct: number): string {
  if (pct >= 90) return "💯 توافق أسطوري!";
  if (pct >= 75) return "🔥 توافق قوي جداً";
  if (pct >= 60) return "💖 توافق جيد";
  if (pct >= 40) return "🙂 توافق متوسط";
  if (pct >= 20) return "😅 توافق ضعيف";
  return "🧊 توافق شبه معدوم";
}

function resultCardText(name1: string, name2: string, pct: number): string {
  return `💞 نسبة التوافق بين «${name1}» و«${name2}»\n\n${compatibilityBar(pct)}\n\n${pct}% — ${compatibilityVerdict(pct)}\n\n🔁 جرّب اسمين آخرين أو شارك النتيجة مع أصدقائك!`;
}

// ---------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------
async function sendAdminStats(bot: TelegramBot, chatId: number) {
  const [usersCount, resultsCount] = await Promise.all([
    prisma.nameCompatUser.count(),
    prisma.nameCompatResult.count(),
  ]);
  await bot.api.sendMessage(
    chatId,
    `📊 إحصائيات بوت نسبة التوافق\n\n👥 المستخدمون: ${usersCount}\n💞 عمليات الحساب: ${resultsCount}`
  );
}

async function handleNameCompatAdmin(bot: TelegramBot, botRow: BotRow, msg: any): Promise<boolean> {
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);
  if (!SUPER_ADMIN_ID || tgUserId !== SUPER_ADMIN_ID) return false;

  const text = String(msg.text || "").trim();
  const adminUser = await ensureNameCompatUser(botRow.id, tgUserId);
  const pending = adminUser.pendingAction as PendingAction | null;

  if (text === "/start") {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "🛠 لوحة تحكم بوت نسبة التوافق.", { reply_markup: adminMenu() });
    return true;
  }
  if (pending?.mode === "admin_broadcast" && text) {
    await setPending(tgUserId, null);
    const recipients = await prisma.nameCompatUser.findMany({ where: { id: { not: SUPER_ADMIN_ID } }, select: { id: true } });
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
    const user = await prisma.nameCompatUser.findUnique({ where: { id: targetId } });
    if (!user) {
      await bot.api.sendMessage(chatId, "لم يتم العثور على مستخدم بهذا الآيدي.");
      return true;
    }
    const muted = user.mutedUntil && user.mutedUntil > new Date();
    await bot.api.sendMessage(
      chatId,
      `🆔 ${targetId}\n💞 عمليات الحساب: ${user.calculationsCount}\n🚫 محظور: ${user.isBanned ? "نعم" : "لا"}\n🔇 مكتوم: ${muted ? `نعم حتى ${user.mutedUntil!.toLocaleString("ar")}` : "لا"}\n\nلحظر/رفع الحظر أرسل: /ban ${targetId} أو /unban ${targetId}`
    );
    return true;
  }
  if (text.startsWith("/ban ") || text.startsWith("/unban ")) {
    const ban = text.startsWith("/ban ");
    const targetId = text.split(" ")[1]?.replace(/[^0-9]/g, "") || "";
    const target = await prisma.nameCompatUser.findUnique({ where: { id: targetId } });
    if (!target) {
      await bot.api.sendMessage(chatId, "لم يتم العثور على مستخدم بهذا الآيدي.");
      return true;
    }
    await prisma.nameCompatUser.update({ where: { id: targetId }, data: { isBanned: ban } });
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
export async function handleNameCompatBotUpdate(bot: TelegramBot, botRow: BotRow, update: any) {
  const msg = update.message;
  if (!msg?.from || !msg.chat) return;
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);

  if (await handleNameCompatAdmin(bot, botRow, msg)) return;

  const user = await ensureNameCompatUser(botRow.id, tgUserId);
  await prisma.nameCompatUser.update({ where: { id: tgUserId }, data: { lastActiveAt: new Date() } }).catch(() => null);

  if (user.isBanned) {
    await bot.api.sendMessage(chatId, "🚫 تم حظرك من استخدام هذا البوت من قِبل الإدارة.");
    return;
  }
  if (user.mutedUntil && user.mutedUntil > new Date()) {
    await bot.api.sendMessage(chatId, "🔇 أنت مكتوم مؤقتاً. حاول لاحقاً.");
    return;
  }

  // Mandatory subscription channel gate (same pattern as AD_BOT/JOBS_BOT/CONFESSION_BOT).
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
      "👋 أهلاً بك في بوت نسبة التوافق!\n\nأرسل اسمين واحصل فوراً على نسبة توافق بينهما — بطاقة نتيجة جاهزة للمشاركة مع أصدقائك.",
      { reply_markup: mainMenu() }
    );
    return;
  }

  const pending = user.pendingAction as PendingAction | null;

  if (pending?.mode === "awaiting_name1") {
    await setPending(tgUserId, { mode: "awaiting_name2", name1: text });
    await bot.api.sendMessage(chatId, "✅ تم استلام الاسم الأول. الآن أرسل الاسم الثاني:", { reply_markup: plainBackMenu() });
    return;
  }

  if (pending?.mode === "awaiting_name2") {
    const name1 = pending.name1;
    const name2 = text;
    const pct = computeCompatibility(name1, name2);

    await prisma.$transaction([
      prisma.nameCompatResult.create({ data: { userId: tgUserId, name1, name2, percentage: pct } }),
      prisma.nameCompatUser.update({ where: { id: tgUserId }, data: { calculationsCount: { increment: 1 } } }),
    ]);
    await setPending(tgUserId, null);

    await bot.api.sendMessage(chatId, resultCardText(name1, name2, pct), {
      reply_markup: new Keyboard().text("💞 احسب نسبة التوافق").text("◀️ رجوع للقائمة الرئيسية").resized(),
    });

    await earnPoints(tgUserId, 1, "name_compat_calculated", botRow.id).catch(() => null);
    return;
  }

  if (text === "💞 احسب نسبة التوافق") {
    await setPending(tgUserId, { mode: "awaiting_name1" });
    await bot.api.sendMessage(chatId, "✍️ أرسل الاسم الأول:", { reply_markup: plainBackMenu() });
    return;
  }

  if (text === "◀️ رجوع للقائمة الرئيسية") {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "🏠 القائمة الرئيسية:", { reply_markup: mainMenu() });
    return;
  }

  if (text === "📜 آخر نتائجي") {
    const results = await prisma.nameCompatResult.findMany({
      where: { userId: tgUserId },
      orderBy: { created_at: "desc" },
      take: HISTORY_PAGE_SIZE,
    });
    if (results.length === 0) {
      await bot.api.sendMessage(chatId, "😔 لا توجد نتائج سابقة بعد. جرّب «💞 احسب نسبة التوافق».", { reply_markup: mainMenu() });
      return;
    }
    const lines = results.map((r) => `«${r.name1}» × «${r.name2}»: ${r.percentage}%`).join("\n");
    await bot.api.sendMessage(chatId, `📜 آخر ${results.length} نتيجة:\n\n${lines}`, { reply_markup: mainMenu() });
    return;
  }

  if (text === "ℹ️ معلومات") {
    await bot.api.sendMessage(
      chatId,
      "ℹ️ بوت نسبة التوافق\n\nأرسل اسمين وستحصل على نسبة توافق ثابتة بينهما (نفس الاسمين يعطيان دائماً نفس النتيجة، بأي ترتيب). شارك بطاقة النتيجة مع أصدقائك للمرح!",
      { reply_markup: mainMenu() }
    );
    return;
  }

  await bot.api.sendMessage(chatId, "لم أفهم طلبك، اختر من القائمة:", { reply_markup: mainMenu() });
}
