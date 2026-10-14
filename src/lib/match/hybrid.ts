/**
 * MARRIAGE_BOT hybrid layer (2026-10-14): inline mode, /start profile_<id>
 * deep links, consent-based anonymous chat requests, and the server side of
 * the per-bot Mini App (/match-app/<botId>). Purely ADDITIVE: it reads and
 * writes the same tables as matchBotLogic.ts (MatchUser, MatchProfile,
 * PartnerPreference, MatchBlock, MatchReport, RandomChatSession) and hands an
 * accepted request to the existing random-chat relay (pendingAction
 * "random_chatting"), so ending/reporting/contact-exchange keep working as-is.
 */
import { Bot as TelegramBot, InlineKeyboard, Keyboard } from "grammy";
import type { Bot as BotRow, MatchProfile } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deliverToUser } from "@/lib/match/surface";
import {
  INLINE_PAGE_SIZE, buildInlineArticle, deepLink, matchesFilter, paginate, parseInlineQuery, publicCardText,
  rateLimit, shortRef, toPublicProfile, type InlineFilter, type PublicProfile,
} from "@/lib/match/inline";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
const REQUEST_TTL_S = 24 * 3600;
const POOL = 500;

const usernameCache = new Map<string, { u: string; at: number }>();
export async function botUsername(bot: TelegramBot, botId: string): Promise<string | null> {
  const c = usernameCache.get(botId);
  if (c && Date.now() - c.at < 6 * 3600 * 1000) return c.u;
  const me = await bot.api.getMe().catch(() => null);
  if (!me?.username) return c?.u ?? null;
  usernameCache.set(botId, { u: me.username, at: Date.now() });
  return me.username;
}

export function miniAppUrl(botId: string): string {
  return `${SITE}/match-app/${encodeURIComponent(botId)}`;
}

/** Profiles that may be shown to `viewerId` outside the normal card flow. */
export async function availableProfiles(botId: string, viewerId: string, filter: InlineFilter): Promise<MatchProfile[]> {
  const viewer = await prisma.matchProfile.findUnique({ where: { userId: viewerId } });
  const gender = filter.gender ?? (viewer ? (viewer.gender === "MALE" ? "FEMALE" : "MALE") : undefined);
  const rows = await prisma.matchProfile.findMany({
    where: {
      status: "APPROVED",
      isHidden: false,
      userId: { not: viewerId },
      age: { gte: Math.max(18, filter.ageMin ?? 18), ...(filter.ageMax != null ? { lte: filter.ageMax } : {}) },
      ...(gender ? { gender } : {}),
      user: { botId, isBanned: false },
    },
    include: { user: { select: { vipUntil: true, lastActiveAt: true } } },
    orderBy: { updated_at: "desc" },
    take: POOL,
  });
  const blocks = await prisma.matchBlock.findMany({ where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] } });
  const blocked = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]));
  let countryOnly = new Set<string>();
  try {
    const r = await prisma.matchProfilePrivacy.findMany({ where: { userId: { in: rows.map((x) => x.userId) }, countryOnly: true }, select: { userId: true } });
    countryOnly = new Set(r.map((x) => x.userId));
  } catch { /* table may not exist yet */ }
  const now = new Date();
  return rows.filter((p) => {
    if (blocked.has(p.userId)) return false;
    // VIP incognito owners are never exported outside the bot.
    if (p.isIncognito && p.user.vipUntil && p.user.vipUntil > now) return false;
    if (countryOnly.has(p.userId) && (!viewer || viewer.country.trim().toLowerCase() !== p.country.trim().toLowerCase())) return false;
    return matchesFilter(p, { ...filter, gender });
  });
}

// ---------------------------------------------------------------------------
// inline_query
// ---------------------------------------------------------------------------
export async function handleMatchInlineQuery(bot: TelegramBot, botRow: BotRow, iq: any) {
  const userId = String(iq.from?.id || "");
  const answer = (results: any[], extra: Record<string, unknown> = {}) =>
    bot.api.answerInlineQuery(iq.id, results, { cache_time: 10, is_personal: true, ...extra } as any).catch(() => null);
  if (!userId) return;
  const username = (await botUsername(bot, botRow.id)) || "";
  const app = { text: "افتح التطبيق 💍", start_parameter: "app" };

  if (!rateLimit(`iq:${botRow.id}:${userId}`, 30, 60_000)) return answer([], { cache_time: 5 });
  const me = await prisma.matchUser.findUnique({ where: { id: userId }, include: { profile: true } });
  // Only registered, phone-verified members with an approved profile can browse
  // inline (stops anonymous scraping of members from any chat).
  if (!me || me.isBanned || !me.phoneVerified || me.profile?.status !== "APPROVED") {
    return answer([], { button: { text: "سجّل ملفك أولاً للبحث 🔒", start_parameter: "inline_register" } });
  }
  const filter = parseInlineQuery(String(iq.query || ""));
  const list = await availableProfiles(botRow.id, userId, filter);
  const { page, nextOffset } = paginate(list, iq.offset, INLINE_PAGE_SIZE);
  const results = page.map((p) => buildInlineArticle(toPublicProfile(p), username, SITE));
  await answer(results, { next_offset: nextOffset, button: app });
}

// ---------------------------------------------------------------------------
// /start profile_<id>
// ---------------------------------------------------------------------------
export function publicCardKeyboard(targetUserId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text("💌 طلب دردشة مجهولة", `mh_req|${targetUserId}`).row()
    .text("❤️ إعجاب", `mlike|${targetUserId}`).row()
    .text("🚩 إبلاغ", `mreport|${targetUserId}`).text("⛔ حظر", `mblock|${targetUserId}`);
}

export async function openProfileDeepLink(bot: TelegramBot, botRow: BotRow, chatId: number, viewerId: string, profileRef: string): Promise<boolean> {
  const p = await prisma.matchProfile.findUnique({ where: { id: profileRef }, include: { user: { select: { botId: true, isBanned: true } } } });
  const blocked = p
    ? await prisma.matchBlock.findFirst({ where: { OR: [{ blockerId: viewerId, blockedId: p.userId }, { blockerId: p.userId, blockedId: viewerId }] } })
    : null;
  if (!p || p.status !== "APPROVED" || p.isHidden || p.user.isBanned || p.user.botId !== botRow.id || blocked || p.age < 18) {
    await bot.api.sendMessage(chatId, "هذا الملف غير متاح الآن.");
    return true;
  }
  if (p.userId === viewerId) {
    await bot.api.sendMessage(chatId, "هذا ملفك أنت 🙂");
    return true;
  }
  await bot.api.sendMessage(chatId, publicCardText(toPublicProfile(p)), { reply_markup: publicCardKeyboard(p.userId) });
  return true;
}

// ---------------------------------------------------------------------------
// Anonymous chat request with the other side's consent
// ---------------------------------------------------------------------------
export type RequestResult = { ok: boolean; message: string };

export async function sendChatRequest(bot: TelegramBot, botRow: BotRow, fromId: string, toId: string, kind: "chat" | "proposal" = "chat"): Promise<RequestResult> {
  if (fromId === toId) return { ok: false, message: "لا يمكنك مراسلة نفسك." };
  if (!rateLimit(`req:${botRow.id}:${fromId}`, 10, 3600_000)) return { ok: false, message: "وصلت للحد المسموح من الطلبات. حاول بعد ساعة." };
  const [from, to] = await Promise.all([
    prisma.matchUser.findUnique({ where: { id: fromId }, include: { profile: true } }),
    prisma.matchUser.findUnique({ where: { id: toId }, include: { profile: true } }),
  ]);
  if (!from?.profile || from.profile.status !== "APPROVED" || !from.phoneVerified) return { ok: false, message: "أكمل ملفك الشخصي أولاً ليتمكن الطرف الآخر من رؤية ملخصك." };
  if (from.isBanned || (from.mutedUntil && from.mutedUntil > new Date())) return { ok: false, message: "حسابك مقيّد حالياً." };
  if (!to?.profile || to.profile.status !== "APPROVED" || to.isBanned || to.botId !== botRow.id) return { ok: false, message: "هذا الملف غير متاح." };
  const blocked = await prisma.matchBlock.findFirst({ where: { OR: [{ blockerId: fromId, blockedId: toId }, { blockerId: toId, blockedId: fromId }] } });
  if (blocked) return { ok: false, message: "هذا الملف غير متاح." };
  const ts = Math.floor(Date.now() / 1000);
  const card = publicCardText(toPublicProfile(from.profile));
  const kb = new InlineKeyboard().text("✅ قبول", `mh_acc|${fromId}|${ts}`).text("❌ رفض", `mh_dec|${fromId}`).row().text("⛔ حظر", `mblock|${fromId}`);
  const sent = await bot.api
    .sendMessage(Number(toId), `${kind === "proposal" ? "💍 طلب تعارف جادّ بغرض الزواج من:" : "💌 طلب دردشة مجهولة الهوية من:"}\n\n${card}\n\nلن يُكشف أي شيء عنك ما لم تقبل. صالح 24 ساعة.`, { reply_markup: kb })
    .catch(() => null);
  if (!sent) return { ok: false, message: "تعذّر إيصال الطلب الآن." };
  return { ok: true, message: "✅ أُرسل طلبك. ستصلك رسالة إذا وافق الطرف الآخر." };
}

function chatMenu(): Keyboard {
  return new Keyboard().text("⏹ إنهاء المحادثة").resized(); // same as matchBotLogic's randomChatMenu
}

async function acceptChatRequest(bot: TelegramBot, botRow: BotRow, accepterId: string, requesterId: string, ts: number): Promise<string> {
  if (!ts || Date.now() / 1000 - ts > REQUEST_TTL_S) return "انتهت صلاحية هذا الطلب.";
  const blocked = await prisma.matchBlock.findFirst({ where: { OR: [{ blockerId: accepterId, blockedId: requesterId }, { blockerId: requesterId, blockedId: accepterId }] } });
  if (blocked) return "لا يمكن بدء هذه المحادثة.";
  const [a, b] = await Promise.all([
    prisma.matchUser.findUnique({ where: { id: accepterId } }),
    prisma.matchUser.findUnique({ where: { id: requesterId } }),
  ]);
  if (!a || !b || b.isBanned) return "هذا الطلب لم يعد متاحاً.";
  const busy = (u: typeof a) => ["random_chatting", "fake_chatting", "random_waiting"].includes((u?.pendingAction as any)?.mode);
  if (busy(a)) return "أنهِ محادثتك الحالية أولاً ثم اقبل الطلب.";
  if (busy(b)) return "الطرف الآخر في محادثة الآن. حاول لاحقاً.";
  const session = await prisma.randomChatSession.create({ data: { user1Id: requesterId, user2Id: accepterId, botId: botRow.id } });
  await prisma.matchUser.update({ where: { id: requesterId }, data: { pendingAction: { mode: "random_chatting", sessionId: session.id, partnerId: accepterId } as any } });
  await prisma.matchUser.update({ where: { id: accepterId }, data: { pendingAction: { mode: "random_chatting", sessionId: session.id, partnerId: requesterId } as any } });
  const hello = "✅ تم الاتصال! ابدأ الدردشة الآن (مجهولة الهوية بالكامل). لا تشارك أرقامك أو حساباتك قبل أن تطمئن.";
  // Requester may be in the app: then the chat opens in the app pane, no Telegram duplicate.
  await deliverToUser(bot, requesterId, hello, { reply_markup: chatMenu() });
  await bot.api.sendMessage(Number(accepterId), hello, { reply_markup: chatMenu() }).catch(() => null);
  return "تم القبول ✅";
}

/** Returns true when the callback belonged to the hybrid layer. */
export async function handleHybridCallback(bot: TelegramBot, botRow: BotRow, cq: any): Promise<boolean> {
  const data = String(cq.data || "");
  if (!data.startsWith("mh_")) return false;
  const userId = String(cq.from.id);
  const [kind, target, tsRaw] = data.split("|");
  let note = "";
  if (kind === "mh_req" && target) {
    note = (await sendChatRequest(bot, botRow, userId, target)).message;
  } else if (kind === "mh_acc" && target) {
    note = await acceptChatRequest(bot, botRow, userId, target, Number(tsRaw));
    if (cq.message) await bot.api.editMessageReplyMarkup(cq.message.chat.id, cq.message.message_id, { reply_markup: new InlineKeyboard() }).catch(() => null);
  } else if (kind === "mh_dec" && target) {
    note = "تم الرفض.";
    if (cq.message) await bot.api.editMessageReplyMarkup(cq.message.chat.id, cq.message.message_id, { reply_markup: new InlineKeyboard() }).catch(() => null);
    await bot.api.sendMessage(Number(target), "🙏 لم يتم قبول طلب الدردشة هذه المرة. تابع البحث، فالملفات كثيرة.").catch(() => null);
  }
  await bot.api.answerCallbackQuery(cq.id, note ? { text: note.slice(0, 190), show_alert: note.length > 40 } : undefined).catch(() => null);
  return true;
}

/** Best-effort: show the Mini App as this bot's menu button (cheap, idempotent). */
const menuSet = new Set<string>();
export async function ensureMiniAppMenu(bot: TelegramBot, botRow: BotRow, chatId: number) {
  const key = `${botRow.id}:${chatId}`;
  if (menuSet.has(key) || process.env.MATCH_MINIAPP_MENU === "0") return;
  menuSet.add(key);
  await bot.api
    .setChatMenuButton({ chat_id: chatId, menu_button: { type: "web_app", text: "التطبيق 💍", web_app: { url: miniAppUrl(botRow.id) } } })
    .catch(() => null);
}

export type { PublicProfile };
export { deepLink, shortRef };
