import { Bot as TelegramBot, Keyboard } from "grammy";
import { prisma } from "@/lib/prisma";
import type { Bot as BotRow } from "@prisma/client";
import { recordBotVisit, countBotVisitors } from "@/lib/botVisit";
import { formatBroadcastText, BROADCAST_COMPOSE_HINT } from "@/lib/utils";
import { earnPoints } from "@/lib/platformPoints";

/**
 * CAPSULE_BOT template — «كبسولة الزمن» ⏳. Write a message to your future
 * self (or to a friend via a share link) and pick a date; the bot delivers
 * it exactly then (daily cron: /api/cron/time-capsules). No AI, no payment.
 *
 * Fully isolated template: own tables (CapsuleUser / Capsule), no shared
 * logic or payment routes with any other bot.
 */

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_TELEGRAM_ID || "";
const MAX_TEXT = 1000;
const MIN_TEXT = 3;
const MAX_PENDING = 10;

const DELAYS: { label: string; days: number }[] = [
  { label: "غداً", days: 1 },
  { label: "بعد أسبوع", days: 7 },
  { label: "بعد شهر", days: 30 },
  { label: "بعد 3 أشهر", days: 90 },
  { label: "بعد 6 أشهر", days: 180 },
  { label: "بعد سنة", days: 365 },
];

type PendingAction =
  | { mode: "awaiting_text"; kind: "SELF" | "FRIEND" }
  | { mode: "awaiting_delay"; kind: "SELF" | "FRIEND"; text: string }
  | { mode: "admin_broadcast" }
  | { mode: "admin_lookup" }
  | { mode: "admin_channel" };

const BACK = "◀️ رجوع";
function mainMenu(): Keyboard {
  return new Keyboard()
    .text("📝 كبسولة لنفسي").text("🎁 كبسولة لصديق").row()
    .text("📦 كبساتي").text("ℹ️ معلومات")
    .resized();
}
function delayMenu(): Keyboard {
  const kb = new Keyboard();
  DELAYS.forEach((d, i) => {
    kb.text(d.label);
    if (i % 2 === 1) kb.row();
  });
  return kb.row().text(BACK).resized();
}
function plainBackMenu(): Keyboard {
  return new Keyboard().text(BACK).resized();
}
function adminMenu(): Keyboard {
  return new Keyboard()
    .text("📊 الإحصائيات").text("🔎 بحث عن مستخدم").row()
    .text("📡 قناة الاشتراك الإجباري").text("📢 بث جماعي")
    .resized();
}

async function ensureCapsuleUser(botId: string, tgUserId: string) {
  return prisma.capsuleUser.upsert({ where: { id: tgUserId }, update: {}, create: { id: tgUserId, botId } });
}
async function setPending(userId: string, action: PendingAction | null) {
  await prisma.capsuleUser.update({ where: { id: userId }, data: { pendingAction: action as any } });
}

function newCode(): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 10; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString("ar", { year: "numeric", month: "long", day: "numeric" });
}

// ---------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------
async function sendAdminStats(bot: TelegramBot, botRow: BotRow, chatId: number) {
  const notAdmin = { id: { not: SUPER_ADMIN_ID || "__none__" } };
  const [ownUsers, total, waiting, delivered, banned] = await Promise.all([
    prisma.capsuleUser.count({ where: { botId: botRow.id, ...notAdmin } }),
    prisma.capsule.count({ where: { botId: botRow.id } }),
    prisma.capsule.count({ where: { botId: botRow.id, deliveredAt: null } }),
    prisma.capsule.count({ where: { botId: botRow.id, deliveredAt: { not: null } } }),
    prisma.capsuleUser.count({ where: { botId: botRow.id, isBanned: true } }),
  ]);
  const usersCount = await countBotVisitors(botRow.id, SUPER_ADMIN_ID, ownUsers);
  await bot.api.sendMessage(
    chatId,
    `📊 إحصائيات بوت كبسولة الزمن\n\n👥 المستخدمون: ${usersCount}\n🚫 المحظورون: ${banned}\n📦 إجمالي الكبسولات: ${total}\n⏳ بانتظار موعدها: ${waiting}\n✅ سُلّمت: ${delivered}`
  );
}

async function handleCapsuleAdmin(bot: TelegramBot, botRow: BotRow, msg: any): Promise<boolean> {
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);
  if (!SUPER_ADMIN_ID || tgUserId !== SUPER_ADMIN_ID) return false;

  const text = String(msg.text || "").trim();
  const adminUser = await ensureCapsuleUser(botRow.id, tgUserId);
  const pending = adminUser.pendingAction as PendingAction | null;

  if (text === "/start" || text.startsWith("/start ")) {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "🛠 لوحة تحكم بوت كبسولة الزمن.", { reply_markup: adminMenu() });
    return true;
  }
  if (pending?.mode === "admin_broadcast" && text) {
    await setPending(tgUserId, null);
    const recipients = await prisma.capsuleUser.findMany({ where: { id: { not: SUPER_ADMIN_ID } }, select: { id: true } });
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
    const user = await prisma.capsuleUser.findUnique({ where: { id: targetId } });
    if (!user) {
      await bot.api.sendMessage(chatId, "لم يتم العثور على مستخدم بهذا الآيدي.");
      return true;
    }
    const muted = user.mutedUntil && user.mutedUntil > new Date();
    await bot.api.sendMessage(
      chatId,
      `🆔 ${targetId}\n📦 كبسولات مكتوبة: ${await prisma.capsule.count({ where: { senderId: targetId } })}\n🚫 محظور: ${user.isBanned ? "نعم" : "لا"}\n🔇 مكتوم: ${muted ? `نعم حتى ${user.mutedUntil!.toLocaleString("ar")}` : "لا"}\n\nلحظر/رفع الحظر أرسل: /ban ${targetId} أو /unban ${targetId}`
    );
    return true;
  }
  if (text.startsWith("/ban ") || text.startsWith("/unban ")) {
    const ban = text.startsWith("/ban ");
    const targetId = text.split(" ")[1]?.replace(/[^0-9]/g, "") || "";
    const target = await prisma.capsuleUser.findUnique({ where: { id: targetId } });
    if (!target) {
      await bot.api.sendMessage(chatId, "لم يتم العثور على مستخدم بهذا الآيدي.");
      return true;
    }
    await prisma.capsuleUser.update({ where: { id: targetId }, data: { isBanned: ban } });
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
async function createCapsule(bot: TelegramBot, botRow: BotRow, chatId: number, tgUserId: string, kind: "SELF" | "FRIEND", text: string, days: number) {
  const pendingCount = await prisma.capsule.count({ where: { senderId: tgUserId, deliveredAt: null } });
  if (pendingCount >= MAX_PENDING) {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, `⚠️ وصلت للحد الأقصى (${MAX_PENDING} كبسولات بانتظار موعدها). انتظر تسليم إحداها ثم أنشئ جديدة.`, { reply_markup: mainMenu() });
    return;
  }
  const deliverAt = new Date(Date.now() + days * 86400000);
  const code = newCode();
  await prisma.capsule.create({ data: { code, botId: botRow.id, senderId: tgUserId, kind, text, deliverAt } });
  await setPending(tgUserId, null);
  await earnPoints(tgUserId, 1, "time_capsule_created", botRow.id).catch(() => null);

  if (kind === "SELF") {
    await bot.api.sendMessage(
      chatId,
      `🔒 تم إغلاق كبسولتك!\n\nستصلك رسالتك في ${fmtDate(deliverAt)}.\nلن تستطيع قراءتها قبل ذلك — هذا هو السحر ✨`,
      { reply_markup: mainMenu() }
    );
    return;
  }
  const me = await bot.api.getMe();
  const link = `https://t.me/${me.username}?start=cap_${code}`;
  await bot.api.sendMessage(
    chatId,
    `🎁 كبسولتك جاهزة!\n\nأرسل هذا الرابط لصديقك — عندما يفتحه تُحجز الكبسولة له وتصله رسالتك في ${fmtDate(deliverAt)}:\n${link}\n\n(إن لم يفتح الرابط قبل الموعد تعود الكبسولة إليك.)`,
    { reply_markup: mainMenu() }
  );
}

async function claimCapsule(bot: TelegramBot, chatId: number, tgUserId: string, code: string) {
  const cap = await prisma.capsule.findUnique({ where: { code } });
  if (!cap || cap.deliveredAt) {
    await bot.api.sendMessage(chatId, "⚠️ هذه الكبسولة غير موجودة أو سُلّمت بالفعل.", { reply_markup: mainMenu() });
    return;
  }
  if (cap.senderId === tgUserId) {
    await bot.api.sendMessage(chatId, "هذه كبسولتك أنت 😄 أرسل الرابط لصديقك ليحجزها.", { reply_markup: mainMenu() });
    return;
  }
  if (cap.kind !== "FRIEND") {
    await bot.api.sendMessage(chatId, "⚠️ هذه الكبسولة خاصة بصاحبها.", { reply_markup: mainMenu() });
    return;
  }
  if (cap.recipientId && cap.recipientId !== tgUserId) {
    await bot.api.sendMessage(chatId, "⚠️ حُجزت هذه الكبسولة لشخص آخر.", { reply_markup: mainMenu() });
    return;
  }
  await prisma.capsule.update({ where: { id: cap.id }, data: { recipientId: tgUserId } });
  await bot.api.sendMessage(
    chatId,
    `🎁 حُجزت لك كبسولة من صديق!\n\nستصلك رسالته في ${fmtDate(cap.deliverAt)} — لا تحذف البوت حتى ذلك الحين ⏳\n\nيمكنك أيضاً كتابة كبسولة لنفسك:`,
    { reply_markup: mainMenu() }
  );
  await bot.api.sendMessage(Number(cap.senderId), "✅ صديقك فتح رابط كبسولتك وحُجزت له. ستصله في الموعد.").catch(() => null);
}

export async function handleCapsuleBotUpdate(bot: TelegramBot, botRow: BotRow, update: any) {
  const msg = update.message;
  if (!msg?.from || !msg.chat) return;
  const chatId = msg.chat.id;
  const tgUserId = String(msg.from.id);

  if (await handleCapsuleAdmin(bot, botRow, msg)) return;

  const user = await ensureCapsuleUser(botRow.id, tgUserId);
  await prisma.capsuleUser.update({ where: { id: tgUserId }, data: { lastActiveAt: new Date() } }).catch(() => null);

  if (user.isBanned) {
    await bot.api.sendMessage(chatId, "🚫 تم حظرك من استخدام هذا البوت من قِبل الإدارة.");
    return;
  }
  if (user.mutedUntil && user.mutedUntil > new Date()) {
    await bot.api.sendMessage(chatId, "🔇 أنت مكتوم مؤقتاً. حاول لاحقاً.");
    return;
  }

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

  if (text === BACK) {
    await setPending(tgUserId, null);
    await bot.api.sendMessage(chatId, "🏠 القائمة الرئيسية:", { reply_markup: mainMenu() });
    return;
  }

  if (text === "/start" || text.startsWith("/start ")) {
    await recordBotVisit(botRow.id, tgUserId);
    await setPending(tgUserId, null);
    const payload = text.slice(6).trim();
    if (payload.startsWith("cap_")) {
      await claimCapsule(bot, chatId, tgUserId, payload.slice(4));
      return;
    }
    await bot.api.sendMessage(
      chatId,
      "⏳ أهلاً بك في «كبسولة الزمن»!\n\nاكتب رسالة لنفسك في المستقبل — أو لصديق — واختر موعد وصولها. سنحتفظ بها ونسلّمها لك في يومها بالضبط.\n\nماذا تحب أن تفعل؟",
      { reply_markup: mainMenu() }
    );
    return;
  }

  const pending = user.pendingAction as PendingAction | null;

  if (pending?.mode === "awaiting_text") {
    if (text.length < MIN_TEXT || text.length > MAX_TEXT) {
      await bot.api.sendMessage(chatId, `⚠️ الرسالة يجب أن تكون بين ${MIN_TEXT} و${MAX_TEXT} حرف. أعد المحاولة:`, { reply_markup: plainBackMenu() });
      return;
    }
    await setPending(tgUserId, { mode: "awaiting_delay", kind: pending.kind, text });
    await bot.api.sendMessage(chatId, "⏰ متى تريد أن تصل هذه الرسالة؟", { reply_markup: delayMenu() });
    return;
  }

  if (pending?.mode === "awaiting_delay") {
    const choice = DELAYS.find((d) => d.label === text);
    if (!choice) {
      await bot.api.sendMessage(chatId, "اختر موعداً من الأزرار بالأسفل:", { reply_markup: delayMenu() });
      return;
    }
    await createCapsule(bot, botRow, chatId, tgUserId, pending.kind, pending.text, choice.days);
    return;
  }

  if (text === "📝 كبسولة لنفسي" || text === "🎁 كبسولة لصديق") {
    const kind = text === "📝 كبسولة لنفسي" ? "SELF" : "FRIEND";
    await setPending(tgUserId, { mode: "awaiting_text", kind });
    await bot.api.sendMessage(
      chatId,
      kind === "SELF" ? "✍️ اكتب رسالتك إلى نفسك في المستقبل (أمنية، هدف، سر، نصيحة...):" : "✍️ اكتب الرسالة التي ستصل صديقك في المستقبل:",
      { reply_markup: plainBackMenu() }
    );
    return;
  }

  if (text === "📦 كبساتي") {
    const [waiting, delivered] = await Promise.all([
      prisma.capsule.findMany({ where: { senderId: tgUserId, deliveredAt: null }, orderBy: { deliverAt: "asc" }, take: 10 }),
      prisma.capsule.count({ where: { OR: [{ senderId: tgUserId }, { recipientId: tgUserId }], deliveredAt: { not: null } } }),
    ]);
    const lines = waiting.map((c) => `${c.kind === "SELF" ? "📝" : "🎁"} تصل ${fmtDate(c.deliverAt)}${c.kind === "FRIEND" && !c.recipientId ? " — بانتظار أن يفتح صديقك الرابط" : ""}`);
    await bot.api.sendMessage(
      chatId,
      waiting.length ? `📦 كبساتك المغلقة:\n\n${lines.join("\n")}\n\n✅ سُلّم لك حتى الآن: ${delivered}` : `لا توجد كبسولات مغلقة الآن.\n✅ سُلّم لك حتى الآن: ${delivered}`,
      { reply_markup: mainMenu() }
    );
    return;
  }

  if (text === "ℹ️ معلومات") {
    const me = await bot.api.getMe();
    await bot.api.sendMessage(
      chatId,
      `ℹ️ كبسولة الزمن ⏳\n\n• 📝 اكتب رسالة لنفسك واختر موعد وصولها (غداً … سنة).\n• 🎁 أو اكتب لصديق: تحصل على رابط، وعندما يفتحه تصله رسالتك في موعدها.\n• 🔒 لا أحد — ولا أنت — يقرأ الكبسولة قبل موعدها.\n• 📦 «كبساتي» تعرض ما هو مغلق حالياً.\n• الحد ${MAX_PENDING} كبسولات مغلقة معاً، و${MAX_TEXT} حرف للرسالة.\n\n📲 شارك البوت: https://t.me/${me.username}`,
      { reply_markup: mainMenu() }
    );
    return;
  }

  await bot.api.sendMessage(chatId, "اختر من القائمة بالأسفل 👇", { reply_markup: mainMenu() });
}
