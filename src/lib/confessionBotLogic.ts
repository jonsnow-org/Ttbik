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

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------
type PendingAction =
  | { mode: "writing_confession"; boxOwnerId: string }
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
    .text("📬 صندوقي").text("⚙️ الترقيات").row()
    .text("💰 رصيدي وإيداع").text("ℹ️ معلومات").row()
    .resized();
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
      await bot.api.sendMessage(
        chatId,
        "✉️ اكتب اعترافك أو سؤالك بحرية — سيصل صاحب الصندوق دون معرفة هويتك:",
        { reply_markup: plainBackMenu() }
      );
      return;
    }

    await bot.api.sendMessage(
      chatId,
      "👋 أهلاً بك في بوت الاعترافات المجهولة!\n\nلديك صندوق اعترافات خاص بك — شارك رابطه ليرسل لك أصدقاؤك اعترافات وأسئلة مجهولة الهوية.",
      { reply_markup: mainMenu() }
    );
    return;
  }

  const pending = user.pendingAction as PendingAction | null;

  if (pending?.mode === "writing_confession") {
    if (await isBlockedFrom(pending.boxOwnerId, tgUserId)) {
      await setPending(tgUserId, null);
      await bot.api.sendMessage(chatId, "🚫 لا يمكنك إرسال رسائل إلى هذا الصندوق.", { reply_markup: mainMenu() });
      return;
    }
    const created = await prisma.confessionMessage.create({
      data: {
        boxOwnerId: pending.boxOwnerId,
        senderId: tgUserId,
        senderName: msg.from.first_name || null,
        senderUsername: msg.from.username || null,
        text,
      },
    });
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "✅ تم إرسال اعترافك بنجاح، لن يعرف صاحب الصندوق هويتك ما لم تكشفها بنفسك.", { reply_markup: mainMenu() });

    const boxOwner = await prisma.confessionUser.findUnique({ where: { id: pending.boxOwnerId } });
    if (boxOwner) {
      const label = senderLabel({ text, senderName: msg.from.first_name || null, senderUsername: msg.from.username || null }, boxOwner.revealSenderUnlocked);
      await bot.api
        .sendMessage(Number(pending.boxOwnerId), `📬 اعتراف جديد من ${label}:\n\n${text}`, {
          reply_markup: new InlineKeyboard()
            .text("↩️ رد", `creply|${created.id}`)
            .text("🚫 حظر المرسل", `cblock|${created.id}`),
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
    await bot.api.sendMessage(Number(message.senderId), `↩️ رد صاحب الصندوق على اعترافك:\n\n${text}`).catch(() => null);
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
    if (messages.length === 0) {
      body += "\n\n😔 لا توجد اعترافات بعد.";
      await bot.api.sendMessage(chatId, body, { reply_markup: mainMenu() });
      return;
    }
    body += `\n\n📥 آخر ${messages.length} اعتراف:`;
    await bot.api.sendMessage(chatId, body, { reply_markup: mainMenu() });
    for (const m of messages) {
      const label = senderLabel(m, user.revealSenderUnlocked);
      const replyBlock = m.reply ? `\n\n↩️ ردك: ${m.reply}` : "";
      const canReply = !m.reply || user.unlimitedRepliesUnlocked;
      const kb = new InlineKeyboard();
      if (canReply) kb.text(m.reply ? "↩️ رد آخر" : "↩️ رد", `creply|${m.id}`);
      kb.text("🚫 حظر المرسل", `cblock|${m.id}`);
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
    await bot.api.sendMessage(
      chatId,
      "ℹ️ بوت الاعترافات المجهولة\n\nكل مستخدم يملك صندوق اعترافات خاصاً به. شارك رابط صندوقك مع أصدقائك ليرسلوا لك اعترافات وأسئلة مجهولة الهوية بحرية تامة، وردّ عليهم دون كشف هويتهم.",
      { reply_markup: mainMenu() }
    );
    return;
  }

  await bot.api.sendMessage(chatId, "لم أفهم طلبك، اختر من القائمة:", { reply_markup: mainMenu() });
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
