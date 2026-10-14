/**
 * Anonymous stranger chat for the Mini App, on the SAME tables and state
 * machine as the bot (RandomChatQueue, RandomChatSession,
 * MatchUser.pendingAction random_waiting/random_chatting). An app user and
 * a bot user match each other; messages are relayed through the bot so a
 * bot-side partner receives them in Telegram, and the bot relay records
 * every message (recordAnonMessage) so the app window can poll them.
 */
import { Bot as TelegramBot, InlineKeyboard, Keyboard } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { anonCandidateOk, revealStep, type AnonFilter } from "@/lib/match/premium";
import { anonMessagesSince, recordAnonMessage } from "@/lib/match/appStore";
import { scrubContacts } from "@/lib/match/inline";
import { containsMatchBannedWords, endRandomChat, revealContacts } from "@/lib/matchBotLogic";

const WAIT_SECONDS = 60;
const chatMenu = () => new Keyboard().text("⏹ إنهاء المحادثة").resized();
const HELLO = "✅ تم الاتصال! ابدأ الدردشة الآن (مجهولة الهوية بالكامل).";

type Pending = { mode?: string; sessionId?: string; partnerId?: string } | null;
const pendingOf = async (id: string): Promise<Pending> =>
  ((await prisma.matchUser.findUnique({ where: { id }, select: { pendingAction: true } }))?.pendingAction as Pending) ?? null;

async function blockedPair(a: string, b: string) {
  return !!(await prisma.matchBlock.findFirst({ where: { OR: [{ blockerId: a, blockedId: b }, { blockerId: b, blockedId: a }] } }));
}

async function tryMatch(bot: TelegramBot, botRow: BotRow, me: string, filter: AnonFilter): Promise<boolean> {
  const waiting = await prisma.randomChatQueue.findMany({
    where: { botId: botRow.id, status: "WAITING", expiresAt: { gt: new Date() }, userId: { not: me } },
    orderBy: { created_at: "asc" },
    take: 50,
    include: { user: { select: { isBanned: true, profile: { select: { gender: true, age: true, country: true } } } } },
  });
  for (const w of waiting) {
    if (w.user.isBanned || !anonCandidateOk(w.user.profile, filter)) continue;
    if (await blockedPair(me, w.userId)) continue;
    const recent = await prisma.randomChatSession.findFirst({
      where: { OR: [{ user1Id: me, user2Id: w.userId }, { user1Id: w.userId, user2Id: me }], created_at: { gt: new Date(Date.now() - 24 * 3600_000) } },
    });
    if (recent) continue;
    // Claim the waiting row atomically so two matchers can't both take it.
    const claimed = await prisma.randomChatQueue.updateMany({ where: { id: w.id, status: "WAITING" }, data: { status: "MATCHED" } });
    if (claimed.count === 0) continue;
    const session = await prisma.randomChatSession.create({ data: { user1Id: me, user2Id: w.userId, botId: botRow.id } });
    await prisma.randomChatQueue.update({ where: { id: w.id }, data: { sessionId: session.id } }).catch(() => null);
    await prisma.randomChatQueue.updateMany({ where: { userId: me, status: "WAITING" }, data: { status: "MATCHED", sessionId: session.id } });
    await prisma.matchUser.update({ where: { id: me }, data: { pendingAction: { mode: "random_chatting", sessionId: session.id, partnerId: w.userId } as any } });
    await prisma.matchUser.update({ where: { id: w.userId }, data: { pendingAction: { mode: "random_chatting", sessionId: session.id, partnerId: me } as any } });
    await bot.api.sendMessage(Number(w.userId), HELLO, { reply_markup: chatMenu() }).catch(() => null);
    await bot.api.sendMessage(Number(me), HELLO + "\n(بدأتها من التطبيق — يمكنك المتابعة هنا أو في التطبيق)", { reply_markup: chatMenu() }).catch(() => null);
    return true;
  }
  return false;
}

export async function anonStart(bot: TelegramBot, botRow: BotRow, me: string, filter: AnonFilter): Promise<{ ok: boolean; error?: string }> {
  const p = await pendingOf(me);
  if (p?.mode === "random_chatting" || p?.mode === "fake_chatting") return { ok: true };
  if (await tryMatch(bot, botRow, me, filter)) return { ok: true };
  await prisma.randomChatQueue.updateMany({ where: { userId: me, status: "WAITING" }, data: { status: "CANCELLED" } });
  await prisma.randomChatQueue.create({ data: { userId: me, botId: botRow.id, status: "WAITING", expiresAt: new Date(Date.now() + WAIT_SECONDS * 1000) } });
  await prisma.matchUser.update({ where: { id: me }, data: { pendingAction: { mode: "random_waiting" } as any } });
  return { ok: true };
}

export type AnonPoll =
  | { state: "idle" }
  | { state: "waiting" }
  | { state: "chatting"; sessionId: string; partner: { age: number; country: string; gender: string } | null; messages: { id: number; mine: boolean; text: string; at: string }[]; reveal: "first" | "waiting" | "mutual" }
  | { state: "ended" };

export async function anonPoll(bot: TelegramBot, botRow: BotRow, me: string, filter: AnonFilter, afterId: number, lastSessionId?: string): Promise<AnonPoll> {
  let p = await pendingOf(me);
  if (p?.mode === "random_waiting") {
    if (await tryMatch(bot, botRow, me, filter)) p = await pendingOf(me);
    else {
      // Keep the app user queued while the app is open (bot users see the same row).
      await prisma.randomChatQueue.updateMany({ where: { userId: me, status: "WAITING" }, data: { expiresAt: new Date(Date.now() + WAIT_SECONDS * 1000) } });
      return { state: "waiting" };
    }
  }
  if (p?.mode === "random_chatting" && p.sessionId && p.partnerId) {
    const [session, partner, msgs] = await Promise.all([
      prisma.randomChatSession.findUnique({ where: { id: p.sessionId } }),
      prisma.matchProfile.findUnique({ where: { userId: p.partnerId }, select: { age: true, country: true, gender: true } }),
      anonMessagesSince(p.sessionId, afterId),
    ]);
    if (!session || session.status !== "ACTIVE") return { state: "ended" };
    return {
      state: "chatting",
      sessionId: p.sessionId,
      partner,
      messages: msgs.map((m) => ({ id: m.id, mine: m.sender_id === me, text: m.text, at: m.created_at.toISOString() })),
      reveal: revealStep(session.contactRequestedBy, me),
    };
  }
  if (lastSessionId) return { state: "ended" };
  return { state: "idle" };
}

export async function anonSend(bot: TelegramBot, me: string, text: string): Promise<{ ok: boolean; error?: string }> {
  const t = text.trim().slice(0, 1000);
  if (!t) return { ok: false, error: "رسالة فارغة" };
  const p = await pendingOf(me);
  if (p?.mode !== "random_chatting" || !p.sessionId || !p.partnerId) return { ok: false, error: "لا توجد محادثة نشطة" };
  if (containsMatchBannedWords(t)) return { ok: false, error: "⚠️ محتوى غير مسموح" };
  if (scrubContacts(t) !== t.replace(/\s+/g, " ").trim()) return { ok: false, error: "🔒 لا تشارك أرقاماً أو حسابات قبل الموافقة المتبادلة على كشف الهوية" };
  const sent = await bot.api.sendMessage(Number(p.partnerId), t).catch(() => null);
  if (!sent) return { ok: false, error: "تعذّر الإرسال" };
  await recordAnonMessage(p.sessionId, me, t);
  await prisma.randomChatSession.update({ where: { id: p.sessionId }, data: { messageCount: { increment: 1 } } }).catch(() => null);
  return { ok: true };
}

export async function anonEnd(bot: TelegramBot, me: string, reason: "end" | "block"): Promise<void> {
  const p = await pendingOf(me);
  if (p?.mode === "random_chatting" && p.sessionId && p.partnerId) {
    await endRandomChat(bot, me, p.sessionId, p.partnerId, reason);
  } else if (p?.mode === "random_waiting") {
    await prisma.randomChatQueue.updateMany({ where: { userId: me, status: "WAITING" }, data: { status: "CANCELLED" } });
    await prisma.matchUser.update({ where: { id: me }, data: { pendingAction: null as any } });
  }
}

export async function anonReport(bot: TelegramBot, me: string): Promise<void> {
  const p = await pendingOf(me);
  if (p?.mode !== "random_chatting" || !p.partnerId) return;
  await prisma.matchReport.create({ data: { reporterId: me, targetId: p.partnerId, source: "RANDOM_CHAT", reason: "من التطبيق" } }).catch(() => null);
  const admin = process.env.SUPER_ADMIN_TELEGRAM_ID;
  if (admin) await bot.api.sendMessage(Number(admin), `🚩 بلاغ من محادثة عشوائية (التطبيق) — المُبلِّغ ${me} ضد ${p.partnerId}.`).catch(() => null);
}

/** Mutual-consent reveal on the existing contactRequestedBy column. */
export async function anonReveal(bot: TelegramBot, me: string): Promise<{ step: "first" | "waiting" | "mutual"; message: string }> {
  const p = await pendingOf(me);
  if (p?.mode !== "random_chatting" || !p.sessionId || !p.partnerId) return { step: "first", message: "لا توجد محادثة" };
  const session = await prisma.randomChatSession.findUnique({ where: { id: p.sessionId } });
  if (!session || session.status !== "ACTIVE") return { step: "first", message: "انتهت المحادثة" };
  const step = revealStep(session.contactRequestedBy, me);
  if (step === "waiting") return { step, message: "⏳ بانتظار موافقة الطرف الآخر" };
  if (step === "first") {
    const n = await prisma.randomChatSession.updateMany({ where: { id: session.id, contactRequestedBy: null }, data: { contactRequestedBy: me } });
    if (n.count) {
      await bot.api
        .sendMessage(Number(p.partnerId), "📇 يرغب الطرف الآخر بتبادل بيانات التواصل الرسمي معك. إن وافقت، اضغط الزر (أو «كشف الهوية» في التطبيق):", {
          reply_markup: new InlineKeyboard().text("✅ أوافق على التبادل", "mcontact"),
        })
        .catch(() => null);
      return { step: "waiting", message: "📨 أُرسل طلب الكشف. لن يُكشف شيء إلا بموافقة الطرفين." };
    }
    return anonReveal(bot, me);
  }
  await revealContacts(bot, me, p.partnerId);
  return { step: "mutual", message: "✅ تمت الموافقة المتبادلة — أُرسلت بيانات التواصل لكما في محادثة البوت." };
}
