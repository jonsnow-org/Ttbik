import { Bot as TelegramBot, Keyboard, InlineKeyboard } from "grammy";
import { prisma } from "@/lib/prisma";
import type { Bot as BotRow } from "@prisma/client";
import { recordBotVisit } from "@/lib/botVisit";
import { formatBroadcastText, BROADCAST_COMPOSE_HINT } from "@/lib/utils";
import { earnPoints } from "@/lib/platformPoints";

/**
 * CONFESSION_BOT template (docs/claude-feature-backlog.md item 2) — every
 * user who talks to the bot gets their own anonymous confessions/questions
 * box for free, behind a personal shareable deep link
 * (https://t.me/<bot>?start=<ownerId>). Whoever writes to that link stays
 * anonymous to the box owner — free tier gets one reply per confession and
 * "🕵️ مرسل مجهول" instead of a name — unless the owner has paid to unlock
 * REVEAL_SENDER and/or UNLIMITED_REPLIES (NOWPayments, same central-wallet
 * pattern as MARRIAGE_BOT/JOBS_BOT — see ConfessionUser.balance).
 *
 * A brand-new, fully isolated template: no shared tables, no shared logic
 * files, no shared payment routes with any other bot on the platform.
 */

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_TELEGRAM_ID || "";
const PRICE_REVEAL_SENDER = 3;
const PRICE_UNLIMITED_REPLIES = 3;
const INBOX_PAGE_SIZE = 10;

// حماية من الإساءة
const MIN_CONFESSION_LENGTH = 5;
const MAX_CONFESSION_LENGTH = 1000;
const MAX_CONFESSIONS_PER_DAY = 20;

// Ready-made openers a sender can pick before writing (optional) — gives
// people who don't know what to write a push, and tells the box owner what
// kind of message it is at a glance.
const TOPICS = ["💭 رأيي فيك بصراحة", "🤫 سر لم أخبرك به", "❓ سؤال محرج", "💌 شيء لم أقله لك", "🙏 اعتذار متأخر", "🌟 شيء يميّزك"];
// One-tap reactions the box owner can send back without writing a reply.
const REACTIONS = ["❤️", "😂", "😮", "😢", "🔥", "🙏"];

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
type PendingAction =
  | { mode: "writing_confession"; boxOwnerId: string; topic?: number; followUpOf?: string }
  | { mode: "replying"; messageId: string }
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
    .text("📬 صندوقي").text("📊 الإحصائيات").row()
    .text("⚙️ الترقيات").text("💰 رصيدي وإيداع").row()
    .text("ℹ️ معلومات").resized();
}
function upgradesMenu(user: Pick<ConfessionUserRow, "revealSenderUnlocked" | "unlimitedRepliesUnlocked">): Keyboard {
  const kb = new Keyboard();
  kb.text(user.revealSenderUnlocked ? "✅ كشف الهوية مفعّل" : `🕵️ كشف هوية المرسلين ($${PRICE_REVEAL_SENDER})`).row();
  kb.text(user.unlimitedRepliesUnlocked ? "✅ ردود غير محدودة مفعّلة" : `♾️ ردود غير محدودة ($${PRICE_UNLIMITED_REPLIES})`).row();
  return kb.text(backLabel()).resized();
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

type ConfessionUserRow = {
  id: string;
  revealSenderUnlocked: boolean;
  unlimitedRepliesUnlocked: boolean;
};

// ---------------------------------------------------------------------
// Core helpers
// ---------------------------------------------------------------------
// upsert, not findUnique-then-create — same race-avoidance reasoning as
// every other ensureXUser in this codebase (two near-simultaneous first
// messages from the same new user must never both pass an existence check).
async function ensureConfessionUser(botId: string, tgUserId: string) {
  return prisma.confessionUser.upsert({ where: { id: tgUserId }, update: {}, create: { id: tgUserId, botId } });
}
async function setPending(userId: string, action: PendingAction | null) {
  await prisma.confessionUser.update({ where: { id: userId }, data: { pendingAction: action as any } });
}
function depositLink(userId: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
  return `${base}/pay/confession?uid=${userId}`;
}
function insufficientBalanceText(userId: string, needed: number, have: number): string {
  return `❌ رصيدك الحالي $${have.toFixed(2)} لا يكفي (المطلوب $${needed.toFixed(2)}). أودِع من هنا:\n${depositLink(userId)}`;
}
// Deducts `amount` from the user's CONFESSION_BOT balance and logs a
// ConfessionTransaction atomically — same shape as chargeMatchUser /
// chargeJobsUser elsewhere in this codebase.
async function chargeConfessionUser(userId: string, amount: number, type: string): Promise<{ ok: boolean; balance: number }> {
  const user = await prisma.confessionUser.findUnique({ where: { id: userId } });
  const balance = Number(user?.balance || 0);
  if (balance < amount) return { ok: false, balance };
  await prisma.$transaction([
    prisma.confessionUser.update({ where: { id: userId }, data: { balance: { decrement: amount } } }),
    prisma.confessionTransaction.create({ data: { userId, amount, currency: "internal", type, status: "COMPLETED" } }),
  ]);
  return { ok: true, balance: balance - amount };
}
async function isBlockedFrom(boxOwnerId: string, senderId: string): Promise<boolean> {
  const b = await prisma.confessionBlock.findUnique({ where: { ownerId_blockedSenderId: { ownerId: boxOwnerId, blockedSenderId: senderId } } });
  return !!b;
}

function senderLabel(msg: { text: string; senderName: string | null; senderUsername: string | null }, revealed: boolean): string {
  if (!revealed) return "🕵️ مرسل مجهول";
  const name = msg.senderName || "بلا اسم";
  return msg.senderUsername ? `${name} (@${msg.senderUsername})` : name;
}
function shortId(id: string): string {
  return id.slice(-6);
}

function excerpt(text: string, max = 80): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// Buttons under a confession in the box owner's chat.
function confessionKeyboard(messageId: string, canReply: boolean, withReactions: boolean, replyLabel = "↩️ رد"): InlineKeyboard {
  const kb = new InlineKeyboard();
  if (withReactions) {
    REACTIONS.forEach((r, i) => kb.text(r, `creact|${messageId}|${i}`));
    kb.row();
  }
  if (canReply) kb.text(replyLabel, `creply|${messageId}`);
  kb.text("🚫 حظر", `cblock|${messageId}`).text("🚩 إبلاغ", `creport|${messageId}`);
  return kb;
}

// Abuse report → the platform owner (SUPER_ADMIN) sees the full message,
// both sides' ids and the real sender, with one-tap actions.
async function sendReportToAdmin(bot: TelegramBot, kind: "confession" | "reply", message: {
  id: string; text: string; reply: string | null; senderId: string; senderName: string | null; senderUsername: string | null; boxOwnerId: string; created_at: Date;
}, reporterId: string) {
  if (!SUPER_ADMIN_ID) return false;
  const offenderId = kind === "confession" ? message.senderId : message.boxOwnerId;
  const [offender, previous] = await Promise.all([
    prisma.confessionUser.findUnique({ where: { id: offenderId } }),
    prisma.confessionMessage.count({ where: kind === "confession" ? { senderId: offenderId } : { boxOwnerId: offenderId, reply: { not: null } } }),
  ]);
  const who = kind === "confession"
    ? `✍️ المرسل: ${message.senderName || "بلا اسم"}${message.senderUsername ? ` (@${message.senderUsername})` : ""} — ${message.senderId}`
    : `✍️ صاحب الصندوق (كاتب الرد): ${message.boxOwnerId}`;
  const body =
    `🚩 بلاغ إساءة — ${kind === "confession" ? "اعتراف" : "رد"}\n\n` +
    `${who}\n👤 المُبلِّغ: ${reporterId}\n🕒 ${message.created_at.toLocaleString("ar")}\n` +
    `📊 سجل المُبلَّغ عنه: ${previous} ${kind === "confession" ? "رسالة مرسلة" : "رد"}${offender?.isBanned ? " — محظور حالياً" : ""}\n\n` +
    (kind === "confession" ? `📝 النص:\n${message.text}` : `📝 الاعتراف:\n${excerpt(message.text, 300)}\n\n↩️ الرد المُبلَّغ عنه:\n${message.reply || "—"}`);
  const kb = new InlineKeyboard()
    .text("⛔ حظر", `cadmin_ban|${offenderId}`).text("🔇 كتم 7 أيام", `cadmin_mute|${offenderId}`).row()
    .text("🗑 حذف الرسالة", `cadmin_del|${message.id}`).text("✅ لا مخالفة", "cadmin_ok");
  const ok = await bot.api.sendMessage(Number(SUPER_ADMIN_ID), body.slice(0, 4000), { reply_markup: kb }).then(() => true).catch(() => false);
  return ok;
}

// إحصائيات شخصية
async function getUserStats(userId: string) {
  const [sent, received, replies, repliesToMe] = await Promise.all([
    prisma.confessionMessage.count({ where: { senderId: userId } }),
    prisma.confessionMessage.count({ where: { boxOwnerId: userId } }),
    prisma.confessionMessage.count({ where: { boxOwnerId: userId, reply: { not: null } } }),
    prisma.confessionMessage.count({ where: { senderId: userId, reply: { not: null } } }),
  ]);
  return { sent, received, replies, repliesToMe };
}

// التحقق من الاعتراف قبل الإرسال
function validateConfession(text: string): { valid: boolean; error?: string } {
  if (text.length < MIN_CONFESSION_LENGTH) return { valid: false, error: `⚠️ الاعتراف قصير جداً (الحد الأدنى ${MIN_CONFESSION_LENGTH} أحرف)` };
  if (text.length > MAX_CONFESSION_LENGTH) return { valid: false, error: `⚠️ الاعتراف طويل جداً (الحد الأقصى ${MAX_CONFESSION_LENGTH} حرف)` };
  return { valid: true };
}

// ---------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------
async function sendAdminStats(bot: TelegramBot, chatId: number) {
  const [usersCount, messagesCount, revenue] = await Promise.all([
    prisma.confessionUser.count(),
    prisma.confessionMessage.count(),
    prisma.confessionTransaction.aggregate({ where: { type: { in: ["REVEAL_SENDER", "UNLIMITED_REPLIES"] } }, _sum: { amount: true } }),
  ]);
  await bot.api.sendMessage(
    chatId,
    `📊 إحصائيات بوت الاعترافات\n\n👥 المستخدمون: ${usersCount}\n✉️ الاعترافات المرسلة: ${messagesCount}\n💵 إيراد الترقيات: $${(revenue._sum.amount || 0).toFixed(2)}`
  );
}

async function handleConfessionAdmin(bot: TelegramBot, botRow: BotRow, msg: any): Promise<boolean> {
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);
  if (!SUPER_ADMIN_ID || tgUserId !== SUPER_ADMIN_ID) return false;

  const text = String(msg.text || "").trim();
  const adminUser = await ensureConfessionUser(botRow.id, tgUserId);
  const pending = adminUser.pendingAction as PendingAction | null;

  if (text === "/start") {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "🛠 لوحة تحكم بوت الاعترافات.", { reply_markup: adminMenu() });
    return true;
  }
  if (pending?.mode === "admin_broadcast" && text) {
    await setPending(tgUserId, null);
    const recipients = await prisma.confessionUser.findMany({ where: { id: { not: SUPER_ADMIN_ID } }, select: { id: true } });
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
    const user = await prisma.confessionUser.findUnique({ where: { id: targetId } });
    if (!user) {
      await bot.api.sendMessage(chatId, "لم يتم العثور على مستخدم بهذا الآيدي.");
      return true;
    }
    const [sentCount, receivedCount] = await Promise.all([
      prisma.confessionMessage.count({ where: { senderId: targetId } }),
      prisma.confessionMessage.count({ where: { boxOwnerId: targetId } }),
    ]);
    const muted = user.mutedUntil && user.mutedUntil > new Date();
    await bot.api.sendMessage(
      chatId,
      `🆔 ${targetId}\n💰 الرصيد: $${user.balance.toFixed(2)}\n🕵️ كشف الهوية: ${user.revealSenderUnlocked ? "✅" : "❌"}\n♾️ ردود غير محدودة: ${user.unlimitedRepliesUnlocked ? "✅" : "❌"}\n📥 اعترافات مستلمة: ${receivedCount}\n📤 اعترافات مرسلة: ${sentCount}\n🚫 محظور: ${user.isBanned ? "نعم" : "لا"}\n🔇 مكتوم: ${muted ? `نعم حتى ${user.mutedUntil!.toLocaleString("ar")}` : "لا"}`,
      { reply_markup: new InlineKeyboard().text(user.isBanned ? "🔓 رفع الحظر" : "⛔ حظر", `cadmin_toggleban|${targetId}`) }
    );
    return true;
  }
  if (pending?.mode === "admin_channel" && text) {
    await setPending(tgUserId, null);
    const skip = text === "⏭ تخطّي";
    await prisma.bot.update({ where: { id: botRow.id }, data: { requiredChannel: skip ? null : text.replace(/^@/, "") } });
    await bot.api.sendMessage(chatId, skip ? "✅ تم إلغاء اشتراط الاشتراك الإجباري." : `✅ تم تعيين قناة الاشتراك الإجباري: @${text.replace(/^@/, "")}`);
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
export async function handleConfessionBotUpdate(bot: TelegramBot, botRow: BotRow, update: any) {
  if (update.callback_query) {
    await handleConfessionCallback(bot, botRow, update.callback_query);
    return;
  }
  const msg = update.message;
  if (!msg?.from || !msg.chat) return;
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);

  if (await handleConfessionAdmin(bot, botRow, msg)) return;

  const user = await ensureConfessionUser(botRow.id, tgUserId);
  await prisma.confessionUser.update({ where: { id: tgUserId }, data: { lastActiveAt: new Date() } }).catch(() => null);

  if (user.isBanned) {
    await bot.api.sendMessage(chatId, "🚫 تم حظرك من استخدام هذا البوت من قِبل الإدارة.");
    return;
  }
  if (user.mutedUntil && user.mutedUntil > new Date()) {
    await bot.api.sendMessage(chatId, "🔇 أنت مكتوم مؤقتاً. حاول لاحقاً.");
    return;
  }

  // Mandatory subscription channel gate (same pattern as AD_BOT/JOBS_BOT).
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

  if (text === "/start" || text.startsWith("/start ")) {
    await recordBotVisit(botRow.id, tgUserId);
    await setPending(tgUserId, null);

    const payload = text.slice(6).trim();
    const boxOwnerId = payload.replace(/\D/g, "");
    if (boxOwnerId && boxOwnerId !== tgUserId) {
      const boxOwner = await prisma.confessionUser.findUnique({ where: { id: boxOwnerId } });
      if (!boxOwner) {
        await bot.api.sendMessage(chatId, "⚠️ هذا الصندوق غير موجود.", { reply_markup: mainMenu() });
        return;
      }
      if (await isBlockedFrom(boxOwnerId, tgUserId)) {
        await bot.api.sendMessage(chatId, "🚫 لا يمكنك إرسال رسائل إلى هذا الصندوق.", { reply_markup: mainMenu() });
        return;
      }
      await setPending(tgUserId, { mode: "writing_confession", boxOwnerId });
      const topics = new InlineKeyboard();
      TOPICS.forEach((t, i) => {
        topics.text(t, `ctopic|${i}`);
        if (i % 2 === 1) topics.row();
      });
      await bot.api.sendMessage(
        chatId,
        "✉️ اكتب رسالتك بحرية — ستصل صاحب الصندوق دون أن يعرف هويتك 🕵️\n\nلا تعرف ماذا تكتب؟ اختر فكرة للبدء:",
        { reply_markup: topics }
      );
      await bot.api.sendMessage(chatId, "✍️ أو اكتب مباشرة:", { reply_markup: plainBackMenu() });
      return;
    }

    const stats = await getUserStats(tgUserId);
    await bot.api.sendMessage(
      chatId,
      `🎭 مرحباً بك في بوت الاعترافات المجهولة!\n\n` +
      `هذا صندوقك الخاص والآمن للاعترافات والأسئلة.\n\n` +
      `✨ كيف يعمل:\n` +
      `• شارك رابط صندوقك مع من تثق بهم\n` +
      `• يرسلون لك اعترافات بدون الكشف عن الهوية\n` +
      `• أنت ترد عليها بحرية\n` +
      `• اختياري: كشف الهوية (3$) أو ردود غير محدودة (3$)\n\n` +
      `📊 إحصائياتك:\n` +
      `📤 أرسلت: ${stats.sent} اعتراف\n` +
      `📥 استقبلت: ${stats.received} اعتراف\n` +
      `↩️ ردود: ${stats.replies}/${stats.received}`,
      { reply_markup: mainMenu() }
    );
    return;
  }

  const pending = user.pendingAction as PendingAction | null;

  if (pending?.mode === "writing_confession") {
    // التحقق من سلامة الاعتراف
    const validation = validateConfession(text);
    if (!validation.valid) {
      await bot.api.sendMessage(chatId, validation.error || "⚠️ الاعتراف غير صحيح", { reply_markup: plainBackMenu() });
      return;
    }

    if (await isBlockedFrom(pending.boxOwnerId, tgUserId)) {
      await setPending(tgUserId, null);
      await bot.api.sendMessage(chatId, "🚫 لا يمكنك إرسال رسائل إلى هذا الصندوق.", { reply_markup: mainMenu() });
      return;
    }

    // التحقق من حد الاعترافات اليومية
    const todayCount = await prisma.confessionMessage.count({
      where: {
        senderId: tgUserId,
        created_at: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    if (todayCount >= MAX_CONFESSIONS_PER_DAY) {
      await bot.api.sendMessage(chatId, `⚠️ وصلت للحد اليومي (${MAX_CONFESSIONS_PER_DAY}) اعترافات. حاول غداً.`, { reply_markup: plainBackMenu() });
      return;
    }

    const topic = pending.topic !== undefined ? TOPICS[pending.topic] : undefined;
    const followUp = pending.followUpOf ? await prisma.confessionMessage.findUnique({ where: { id: pending.followUpOf } }) : null;
    const header = followUp ? `↪️ متابعة على رسالة #${shortId(followUp.id)}\n` : topic ? `${topic}\n` : "";
    const created = await prisma.confessionMessage.create({
      data: {
        boxOwnerId: pending.boxOwnerId,
        senderId: tgUserId,
        senderName: msg.from.first_name || null,
        senderUsername: msg.from.username || null,
        text: header + text,
      },
    });
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "✅ وصلت رسالتك 🎭\n\nلن يعرف صاحب الصندوق هويتك، وسيصلك هنا ردّه أو تفاعله إن ردّ.", { reply_markup: mainMenu() });

    const boxOwner = await prisma.confessionUser.findUnique({ where: { id: pending.boxOwnerId } });
    if (boxOwner) {
      const label = senderLabel({ text, senderName: msg.from.first_name || null, senderUsername: msg.from.username || null }, boxOwner.revealSenderUnlocked);
      await bot.api
        .sendMessage(Number(pending.boxOwnerId), `📬 ${followUp ? "رد جديد في محادثة مجهولة" : "اعتراف جديد"} من ${label}:\n\n${created.text}`, {
          reply_markup: confessionKeyboard(created.id, true, true),
        })
        .catch(() => null);
    }

    await earnPoints(tgUserId, 2, "confession_sent", botRow.id).catch(() => null);
    await earnPoints(pending.boxOwnerId, 1, "confession_received", botRow.id).catch(() => null);
    return;
  }

  if (pending?.mode === "replying") {
    const message = await prisma.confessionMessage.findUnique({ where: { id: pending.messageId } });
    if (!message || message.boxOwnerId !== tgUserId) {
      await setPending(tgUserId, null);
      await bot.api.sendMessage(chatId, "⚠️ هذا الاعتراف لم يعد متاحاً.", { reply_markup: mainMenu() });
      return;
    }
    await prisma.confessionMessage.update({
      where: { id: message.id },
      data: { reply: text, repliedAt: new Date(), replyCount: { increment: 1 } },
    });
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "✅ تم إرسال ردك.", { reply_markup: mainMenu() });
    await bot.api
      .sendMessage(Number(message.senderId), `↩️ رد صاحب الصندوق على رسالتك:\n«${excerpt(message.text)}»\n\n${text}`, {
        reply_markup: new InlineKeyboard().text("💬 رد مجهول", `cfollow|${message.id}`).text("🚩 إبلاغ", `creportr|${message.id}`),
      })
      .catch(() => null);
    return;
  }

  if (text === "📊 الإحصائيات") {
    const stats = await getUserStats(tgUserId);
    await bot.api.sendMessage(
      chatId,
      `📊 إحصائياتك الشاملة:\n\n` +
      `📤 اعترافات أرسلتها: ${stats.sent}\n` +
      `📥 اعترافات استقبلتها: ${stats.received}\n` +
      `↩️ عدد الردود: ${stats.replies} من ${stats.received} (${stats.received > 0 ? Math.round((stats.replies / stats.received) * 100) : 0}%)\n` +
      `💬 ردود وصلتك على اعترافاتك: ${stats.repliesToMe}\n\n` +
      `💰 رصيدك: $${user.balance.toFixed(2)}\n` +
      `🕵️ كشف الهوية: ${user.revealSenderUnlocked ? "✅ مفعّل" : "❌ غير مفعّل"}\n` +
      `♾️ ردود غير محدودة: ${user.unlimitedRepliesUnlocked ? "✅ مفعّل" : "❌ غير مفعّل"}`,
      { reply_markup: mainMenu() }
    );
    return;
  }

  if (text === "📬 صندوقي") {
    const me = await bot.api.getMe();
    const link = `https://t.me/${me.username}?start=${tgUserId}`;
    const messages = await prisma.confessionMessage.findMany({
      where: { boxOwnerId: tgUserId },
      orderBy: { created_at: "desc" },
      take: INBOX_PAGE_SIZE,
    });
    let body = `🔗 رابط صندوقك — شاركه ليصلك الاعترافات:\n${link}`;
    const shareText = "أرسل لي رسالة مجهولة 👀 لن أعرف من أنت أبداً 🤫";
    const shareKb = new InlineKeyboard().url(
      "📣 انشر صندوقي في محادثاتك ومجموعاتك",
      `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`
    );
    if (messages.length === 0) {
      body += "\n\n😔 لا توجد اعترافات بعد — انشر رابطك ليبدأ أصدقاؤك بالكتابة.";
      await bot.api.sendMessage(chatId, body, { reply_markup: shareKb });
      return;
    }
    body += `\n\n📥 آخر ${messages.length} اعتراف:`;
    await bot.api.sendMessage(chatId, body, { reply_markup: shareKb });
    for (const m of messages) {
      const label = senderLabel(m, user.revealSenderUnlocked);
      const replyBlock = m.reply ? `\n\n↩️ ردك: ${m.reply}` : "";
      const canReply = !m.reply || user.unlimitedRepliesUnlocked;
      const kb = confessionKeyboard(m.id, canReply, !m.reply, m.reply ? "↩️ رد آخر" : "↩️ رد");
      await bot.api.sendMessage(chatId, `#${shortId(m.id)} — ${label}:\n\n${m.text}${replyBlock}`, { reply_markup: kb }).catch(() => null);
    }
    return;
  }

  if (text === "⚙️ الترقيات") {
    await bot.api.sendMessage(
      chatId,
      `⚙️ ترقيات صندوقك\n\n🕵️ كشف هوية المرسلين ($${PRICE_REVEAL_SENDER}) — اسم وحساب تلجرام كل من يرسل لك، على كل اعترافاتك القديمة والجديدة.\n♾️ ردود غير محدودة ($${PRICE_UNLIMITED_REPLIES}) — بدون هذه الترقية، رد واحد مجاني فقط لكل اعتراف.`,
      { reply_markup: upgradesMenu(user) }
    );
    return;
  }
  if (text === `🕵️ كشف هوية المرسلين ($${PRICE_REVEAL_SENDER})`) {
    const charge = await chargeConfessionUser(tgUserId, PRICE_REVEAL_SENDER, "REVEAL_SENDER");
    if (!charge.ok) {
      await bot.api.sendMessage(chatId, insufficientBalanceText(tgUserId, PRICE_REVEAL_SENDER, charge.balance), { reply_markup: upgradesMenu(user) });
      return;
    }
    const updated = await prisma.confessionUser.update({ where: { id: tgUserId }, data: { revealSenderUnlocked: true } });
    await bot.api.sendMessage(chatId, "✅ تم تفعيل كشف هوية المرسلين.", { reply_markup: upgradesMenu(updated) });
    return;
  }
  if (text === `♾️ ردود غير محدودة ($${PRICE_UNLIMITED_REPLIES})`) {
    const charge = await chargeConfessionUser(tgUserId, PRICE_UNLIMITED_REPLIES, "UNLIMITED_REPLIES");
    if (!charge.ok) {
      await bot.api.sendMessage(chatId, insufficientBalanceText(tgUserId, PRICE_UNLIMITED_REPLIES, charge.balance), { reply_markup: upgradesMenu(user) });
      return;
    }
    const updated = await prisma.confessionUser.update({ where: { id: tgUserId }, data: { unlimitedRepliesUnlocked: true } });
    await bot.api.sendMessage(chatId, "✅ تم تفعيل الردود غير المحدودة.", { reply_markup: upgradesMenu(updated) });
    return;
  }

  if (text === "💰 رصيدي وإيداع") {
    await bot.api.sendMessage(chatId, `💰 رصيدك الحالي: $${user.balance.toFixed(2)}\n\nللإيداع:\n${depositLink(tgUserId)}`, { reply_markup: mainMenu() });
    return;
  }

  if (text === "ℹ️ معلومات") {
    const me = await bot.api.getMe();
    const info =
      `🎭 بوت الاعترافات المجهولة\n\n` +
      `منصة آمنة لتبادل الرسائل والاعترافات والأسئلة دون كشف هوية المرسل.\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📬 صندوقك الشخصي:\n` +
      `• لكل مستخدم صندوق اعترافات خاص به.\n` +
      `• شارك رابط صندوقك مع أصدقائك أو في حالتك.\n` +
      `• يرسلون لك رسائل واعترافات مجهولة بالكامل.\n` +
      `• تقرأها وترد عليها بحرية — ردّك يصل المرسل مجهولاً أيضاً.\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `💬 المحادثة المجهولة:\n` +
      `• يستطيع المرسل الرد على ردّك دون أن تنكشف هويته.\n` +
      `• محادثة ذهاباً وإياباً بشكل مجهول تماماً من الطرفين.\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `❤️ التفاعل بضغطة واحدة:\n` +
      `• عند وصول اعتراف يمكنك التفاعل فوراً بأحد الإيموجي:\n` +
      `  ❤️ 😂 😮 😢 🔥 🙏\n` +
      `• يصل التفاعل للمرسل فوراً.\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `💡 أفكار جاهزة:\n` +
      `• عند فتح صندوق شخص آخر تظهر لك مواضيع مقترحة تساعدك على البدء (مثلاً: "قل لي شيئاً لم تقله لي من قبل").\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📊 الإحصائيات:\n` +
      `• تتبع عدد الرسائل المستلمة والمرسلة والردود.\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `🚩 الحماية من الإساءة:\n` +
      `• زر إبلاغ مباشر على كل رسالة مسيئة.\n` +
      `• يصل البلاغ للإدارة فوراً مع الرسالة وسياقها.\n` +
      `• الإدارة تتخذ الإجراء المناسب: حظر أو كتم أو حذف.\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `📢 انشر صندوقك:\n` +
      `• زر مشاركة جاهز يرسل رابط صندوقك لأي محادثة أو مجموعة.\n\n` +
      `━━━━━━━━━━━━━━━\n` +
      `⚙️ الترقيات:\n` +
      `• 🕵️ كشف هوية المرسلين — اعرف من أرسل لك.\n` +
      `• ♾️ ردود غير محدودة — رد بلا حدود.\n\n` +
      `🔒 أمانك مضمون — المرسلون مجهولون دائماً ما لم تفعّل كشف الهوية.\n\n` +
      `📲 شارك البوت: https://t.me/${me.username}`;
    await bot.api.sendMessage(chatId, info, { reply_markup: mainMenu() });
    return;
  }

  await bot.api.sendMessage(chatId, "❓ لم أفهم طلبك. اختر من القائمة أعلاه.", { reply_markup: mainMenu() });
}

async function handleConfessionCallback(bot: TelegramBot, botRow: BotRow, cq: any) {
  const chatId = cq.message?.chat?.id;
  const tgUserId = String(cq.from.id);
  const data = String(cq.data || "");
  if (!chatId) return;

  if (data.startsWith("cadmin_")) {
    if (!SUPER_ADMIN_ID || tgUserId !== SUPER_ADMIN_ID) {
      await bot.api.answerCallbackQuery(cq.id).catch(() => null);
      return;
    }
    if (data.startsWith("cadmin_toggleban|")) {
      const targetId = data.split("|")[1];
      const target = await prisma.confessionUser.findUnique({ where: { id: targetId } });
      if (!target) {
        await bot.api.answerCallbackQuery(cq.id, { text: "غير موجود" }).catch(() => null);
        return;
      }
      const nowBanned = !target.isBanned;
      await prisma.confessionUser.update({ where: { id: targetId }, data: { isBanned: nowBanned } });
      await bot.api
        .sendMessage(Number(targetId), nowBanned ? "🚫 تم حظرك من استخدام هذا البوت من قِبل الإدارة." : "✅ تم رفع الحظر عنك من قِبل الإدارة، يمكنك استخدام البوت الآن.")
        .catch(() => null);
      await bot.api.answerCallbackQuery(cq.id, { text: nowBanned ? "⛔ تم الحظر" : "🔓 تم رفع الحظر" }).catch(() => null);
      return;
    }
    // Actions from an abuse-report card (see sendReportToAdmin).
    const [action, arg] = data.split("|");
    const done = async (label: string) => {
      await bot.api.answerCallbackQuery(cq.id, { text: label }).catch(() => null);
      await bot.api
        .editMessageReplyMarkup(chatId, cq.message.message_id, { reply_markup: new InlineKeyboard().text(`✔️ ${label}`, "cadmin_noop") })
        .catch(() => null);
    };
    if (action === "cadmin_ban" && arg) {
      await prisma.confessionUser.update({ where: { id: arg }, data: { isBanned: true } }).catch(() => null);
      await bot.api.sendMessage(Number(arg), "🚫 تم حظرك من استخدام هذا البوت من قِبل الإدارة بسبب مخالفة.").catch(() => null);
      return done("تم الحظر");
    }
    if (action === "cadmin_mute" && arg) {
      await prisma.confessionUser.update({ where: { id: arg }, data: { mutedUntil: new Date(Date.now() + 7 * 24 * 3600 * 1000) } }).catch(() => null);
      await bot.api.sendMessage(Number(arg), "🔇 تم إيقافك عن استخدام البوت 7 أيام من قِبل الإدارة بسبب مخالفة.").catch(() => null);
      return done("تم الكتم 7 أيام");
    }
    if (action === "cadmin_del" && arg) {
      await prisma.confessionMessage.delete({ where: { id: arg } }).catch(() => null);
      return done("حُذفت الرسالة");
    }
    if (action === "cadmin_ok") return done("لا مخالفة");
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }

  const actor = await ensureConfessionUser(botRow.id, tgUserId);
  if (actor.isBanned || (actor.mutedUntil && actor.mutedUntil > new Date())) {
    await bot.api.answerCallbackQuery(cq.id, { text: "🚫 غير متاح" }).catch(() => null);
    return;
  }

  if (data.startsWith("ctopic|")) {
    const i = Number(data.split("|")[1]);
    const pending = actor.pendingAction as PendingAction | null;
    if (pending?.mode !== "writing_confession" || !TOPICS[i]) {
      await bot.api.answerCallbackQuery(cq.id, { text: "افتح رابط الصندوق من جديد" }).catch(() => null);
      return;
    }
    await setPending(tgUserId, { ...pending, topic: i });
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    await bot.api.sendMessage(chatId, `${TOPICS[i]}\n\n✍️ اكتب رسالتك الآن:`, { reply_markup: plainBackMenu() });
    return;
  }

  // The sender answers the box owner's reply — still anonymous.
  if (data.startsWith("cfollow|")) {
    const message = await prisma.confessionMessage.findUnique({ where: { id: data.split("|")[1] } });
    if (!message || message.senderId !== tgUserId) {
      await bot.api.answerCallbackQuery(cq.id, { text: "غير متاح" }).catch(() => null);
      return;
    }
    if (await isBlockedFrom(message.boxOwnerId, tgUserId)) {
      await bot.api.answerCallbackQuery(cq.id, { text: "🚫 لا يمكنك الكتابة لهذا الصندوق" }).catch(() => null);
      return;
    }
    await setPending(tgUserId, { mode: "writing_confession", boxOwnerId: message.boxOwnerId, followUpOf: message.id });
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    await bot.api.sendMessage(chatId, "💬 اكتب ردك — سيصل دون كشف هويتك:", { reply_markup: plainBackMenu() });
    return;
  }

  // Box owner reacts with one emoji; the sender is told which.
  if (data.startsWith("creact|")) {
    const [, messageId, idx] = data.split("|");
    const message = await prisma.confessionMessage.findUnique({ where: { id: messageId } });
    const emoji = REACTIONS[Number(idx)];
    if (!message || message.boxOwnerId !== tgUserId || !emoji) {
      await bot.api.answerCallbackQuery(cq.id, { text: "غير متاح" }).catch(() => null);
      return;
    }
    await bot.api
      .sendMessage(Number(message.senderId), `${emoji} تفاعل صاحب الصندوق مع رسالتك:\n«${excerpt(message.text)}»`, {
        reply_markup: new InlineKeyboard().text("💬 أرسل له رسالة أخرى", `cfollow|${message.id}`),
      })
      .catch(() => null);
    const canReply = message.replyCount === 0 || actor.unlimitedRepliesUnlocked;
    await bot.api
      .editMessageReplyMarkup(chatId, cq.message.message_id, { reply_markup: confessionKeyboard(message.id, canReply, false, message.reply ? "↩️ رد آخر" : "↩️ رد") })
      .catch(() => null);
    await bot.api.answerCallbackQuery(cq.id, { text: `أُرسل ${emoji}` }).catch(() => null);
    return;
  }

  // Abuse reports: on a confession (by the box owner) or on a reply (by the sender).
  if (data.startsWith("creport|") || data.startsWith("creportr|")) {
    const isReply = data.startsWith("creportr|");
    const message = await prisma.confessionMessage.findUnique({ where: { id: data.split("|")[1] } });
    const allowed = message && (isReply ? message.senderId === tgUserId && !!message.reply : message.boxOwnerId === tgUserId);
    if (!message || !allowed) {
      await bot.api.answerCallbackQuery(cq.id, { text: "غير متاح" }).catch(() => null);
      return;
    }
    const sent = await sendReportToAdmin(bot, isReply ? "reply" : "confession", message, tgUserId);
    await bot.api
      .answerCallbackQuery(cq.id, { text: sent ? "🚩 وصل بلاغك للإدارة، شكراً لك" : "تعذّر إرسال البلاغ الآن", show_alert: sent })
      .catch(() => null);
    if (sent && !isReply) {
      // Blocking right away is what most people want after reporting.
      await prisma.confessionBlock.create({ data: { ownerId: tgUserId, blockedSenderId: message.senderId } }).catch(() => null);
      await bot.api.sendMessage(chatId, "🚫 وتم أيضاً حظر هذا المرسل من صندوقك.").catch(() => null);
    }
    return;
  }

  if (data.startsWith("creply|")) {
    const messageId = data.split("|")[1];
    const message = await prisma.confessionMessage.findUnique({ where: { id: messageId } });
    if (!message || message.boxOwnerId !== tgUserId) {
      await bot.api.answerCallbackQuery(cq.id, { text: "غير متاح" }).catch(() => null);
      return;
    }
    const owner = await ensureConfessionUser(botRow.id, tgUserId);
    if (message.replyCount > 0 && !owner.unlimitedRepliesUnlocked) {
      await bot.api.answerCallbackQuery(cq.id, { text: "استخدمت ردك المجاني على هذا الاعتراف" }).catch(() => null);
      await bot.api.sendMessage(
        chatId,
        `🔒 لقد استخدمت ردك المجاني على هذا الاعتراف. فعّل ♾️ ردود غير محدودة ($${PRICE_UNLIMITED_REPLIES}) لمتابعة الرد:`,
        { reply_markup: upgradesMenu(owner) }
      );
      return;
    }
    await setPending(tgUserId, { mode: "replying", messageId: message.id });
    await bot.api.sendMessage(chatId, "✍️ اكتب ردك:", { reply_markup: plainBackMenu() });
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    return;
  }

  if (data.startsWith("cblock|")) {
    const messageId = data.split("|")[1];
    const message = await prisma.confessionMessage.findUnique({ where: { id: messageId } });
    if (!message || message.boxOwnerId !== tgUserId) {
      await bot.api.answerCallbackQuery(cq.id, { text: "غير متاح" }).catch(() => null);
      return;
    }
    await prisma.confessionBlock
      .create({ data: { ownerId: tgUserId, blockedSenderId: message.senderId } })
      .catch(() => null); // already blocked — unique constraint, safe to ignore
    await bot.api.answerCallbackQuery(cq.id, { text: "🚫 تم حظر المرسل" }).catch(() => null);
    return;
  }
}
