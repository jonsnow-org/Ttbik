/**
 * MARRIAGE_BOT Mini App social layer (2026-10-14, additive): in-app direct
 * messages with the stranger paywall, the 🔔 notifications feed and the
 * one-shot «update your profile» broadcast. Own tables only (appStore v7);
 * bot tables are read, never altered.
 */
import { Bot as TelegramBot, InlineKeyboard } from "grammy";
import { prisma } from "@/lib/prisma";
import { ensureMatchAppTables } from "@/lib/match/appStore";
import { chargeMatchUser } from "@/lib/match/entitlements";
import { DM_FREE_PER_SIDE, PRICE_DM_UNLOCK, dmAllowed, isVipActive } from "@/lib/match/entitlementRules";
import { containsContactInfo } from "@/lib/match/contactGuard";
import { pgRateLimit } from "@/lib/match/rateLimitPg";

export type DmMsg = { id: number; mine: boolean; text: string; at: string; read: boolean };

export async function isMutual(a: string, b: string): Promise<boolean> {
  const [ab, ba] = await Promise.all([
    prisma.matchLike.findUnique({ where: { fromUserId_toUserId: { fromUserId: a, toUserId: b } } }),
    prisma.matchLike.findUnique({ where: { fromUserId_toUserId: { fromUserId: b, toUserId: a } } }),
  ]);
  return !!ab && !!ba;
}

/** Everything the client needs to know about one conversation's paywall. */
export async function dmState(me: string, peer: string) {
  await ensureMatchAppTables();
  const [matched, sent, unl, user] = await Promise.all([
    isMutual(me, peer),
    prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM match_dm WHERE sender_id = ${me} AND recipient_id = ${peer}`,
    prisma.$queryRaw<{ x: number }[]>`SELECT 1 AS x FROM match_dm_unlock WHERE user_id = ${me} AND peer_id = ${peer}`,
    prisma.matchUser.findUnique({ where: { id: me }, select: { vipUntil: true } }),
  ]);
  const sentByMe = Number(sent[0]?.n || 0);
  const unlocked = unl.length > 0;
  const vip = isVipActive({ vipUntil: user?.vipUntil ?? null });
  return { matched, sentByMe, unlocked, vip, freeLeft: matched || unlocked || vip ? null : Math.max(0, DM_FREE_PER_SIDE - sentByMe), allowed: dmAllowed({ matched, sentByMe, unlocked, vip }), price: PRICE_DM_UNLOCK };
}

export type DmSendResult = { ok: true; id: number } | { ok: false; error: string; paywall?: boolean };

export async function sendDm(bot: TelegramBot, botId: string, appUrl: string, me: string, peer: string, raw: string, bannedWords: (t: string) => boolean): Promise<DmSendResult> {
  const text = String(raw || "").replace(/\s+/g, " ").trim().slice(0, 1000);
  if (!text) return { ok: false, error: "اكتب رسالة" };
  if (me === peer) return { ok: false, error: "لا يمكنك مراسلة نفسك" };
  if (!(await pgRateLimit(`dm:${me}`, 30, 60))) return { ok: false, error: "تمهّل قليلاً" };
  const blocked = await prisma.matchBlock.findFirst({ where: { OR: [{ blockerId: me, blockedId: peer }, { blockerId: peer, blockedId: me }] } });
  if (blocked) return { ok: false, error: "هذا الملف غير متاح" };
  if (bannedWords(text)) return { ok: false, error: "⚠️ هذه الرسالة تحتوي على محتوى غير مسموح به." };
  const st = await dmState(me, peer);
  // Contacts are exchanged only through the bot's consent flow (and never to strangers).
  if (!st.matched && containsContactInfo(text)) return { ok: false, error: "🔒 لا تشارك أرقاماً أو حسابات قبل الإعجاب المتبادل" };
  if (!st.allowed) return { ok: false, error: `انتهت رسائلك المجانية (${DM_FREE_PER_SIDE}). افتح المحادثة بـ $${PRICE_DM_UNLOCK} أو بالعضوية الذهبية.`, paywall: true };
  const r = await prisma.$queryRaw<{ id: bigint }[]>`INSERT INTO match_dm (bot_id, sender_id, recipient_id, text) VALUES (${botId}, ${me}, ${peer}, ${text}) RETURNING id`;
  // One Telegram nudge per conversation per 10 min (message content is never sent outside the app).
  if (await pgRateLimit(`dmnudge:${peer}:${me}`, 1, 600)) {
    const kb = new InlineKeyboard().webApp("💬 افتح المحادثات", appUrl);
    await bot.api.sendMessage(Number(peer), st.matched ? "💬 رسالة جديدة من إعجاب متبادل — افتح التطبيق للرد." : "📨 رسالة جديدة من عضو (طلب تعارف) — افتح التطبيق لقراءتها.", { reply_markup: kb }).catch(() => null);
  }
  return { ok: true, id: Number(r[0].id) };
}

export async function unlockDm(me: string, peer: string): Promise<{ ok: true; message: string } | { ok: false; reason: "insufficient"; needed: number; balance: number }> {
  const st = await dmState(me, peer);
  if (st.matched || st.unlocked || st.vip) return { ok: true, message: "المحادثة مفتوحة بالفعل" };
  const charge = await chargeMatchUser(me, PRICE_DM_UNLOCK, "DM_UNLOCK");
  if (!charge.ok) return { ok: false, reason: "insufficient", needed: PRICE_DM_UNLOCK, balance: charge.balance };
  await prisma.$executeRaw`INSERT INTO match_dm_unlock (user_id, peer_id) VALUES (${me}, ${peer}) ON CONFLICT DO NOTHING`;
  return { ok: true, message: `🔓 تم فتح المحادثة (-$${PRICE_DM_UNLOCK})` };
}

export async function dmThread(me: string, peer: string, after = 0): Promise<DmMsg[]> {
  await ensureMatchAppTables();
  const rows = await prisma.$queryRaw<{ id: bigint; sender_id: string; text: string; created_at: Date; read_at: Date | null }[]>`
    SELECT id, sender_id, text, created_at, read_at FROM match_dm
    WHERE ((sender_id = ${me} AND recipient_id = ${peer}) OR (sender_id = ${peer} AND recipient_id = ${me})) AND id > ${after}
    ORDER BY id ASC LIMIT 200`;
  await prisma.$executeRaw`UPDATE match_dm SET read_at = now() WHERE recipient_id = ${me} AND sender_id = ${peer} AND read_at IS NULL`;
  return rows.map((r) => ({ id: Number(r.id), mine: r.sender_id === me, text: r.text, at: r.created_at.toISOString(), read: !!r.read_at }));
}

export async function dmThreads(me: string, botId: string): Promise<{ peer: string; last: string; at: string; mine: boolean; unread: number }[]> {
  await ensureMatchAppTables();
  const rows = await prisma.$queryRaw<{ peer: string; last: string; at: Date; mine: boolean; unread: bigint }[]>`
    WITH t AS (
      SELECT CASE WHEN sender_id = ${me} THEN recipient_id ELSE sender_id END AS peer, id, text, created_at, sender_id = ${me} AS mine,
             (recipient_id = ${me} AND read_at IS NULL) AS unread
      FROM match_dm WHERE bot_id = ${botId} AND (sender_id = ${me} OR recipient_id = ${me})
    )
    SELECT DISTINCT ON (peer) peer, text AS last, created_at AS at, mine,
           (SELECT count(*) FROM t t2 WHERE t2.peer = t.peer AND t2.unread) AS unread
    FROM t ORDER BY peer, id DESC`;
  return rows.map((r) => ({ peer: r.peer, last: r.last.slice(0, 80), at: r.at.toISOString(), mine: r.mine, unread: Number(r.unread) })).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 50);
}

export async function dmUnreadCount(me: string): Promise<number> {
  await ensureMatchAppTables();
  const r = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM match_dm WHERE recipient_id = ${me} AND read_at IS NULL`;
  return Number(r[0]?.n || 0);
}

// ---- 🔔 notifications feed (no messages here — those are the Chats badge) -----------------------
export async function pushNotification(userId: string, kind: string, text: string): Promise<void> {
  try {
    await ensureMatchAppTables();
    await prisma.$executeRaw`INSERT INTO match_notifications (user_id, kind, text) VALUES (${userId}, ${kind}, ${text.slice(0, 300)})`;
  } catch { /* the feed must never break the bot flow */ }
}

export type FeedItem = { kind: string; text: string; at: string };
export async function notificationFeed(me: string): Promise<FeedItem[]> {
  await ensureMatchAppTables();
  const since = new Date(Date.now() - 30 * 86400_000);
  const [likes, mine, stored] = await Promise.all([
    prisma.matchLike.findMany({ where: { toUserId: me, created_at: { gt: since } }, orderBy: { created_at: "desc" }, take: 50, select: { fromUserId: true, created_at: true } }),
    prisma.matchLike.findMany({ where: { fromUserId: me }, select: { toUserId: true, created_at: true } }),
    prisma.$queryRaw<{ kind: string; text: string; created_at: Date }[]>`SELECT kind, text, created_at FROM match_notifications WHERE user_id = ${me} AND created_at > ${since} ORDER BY id DESC LIMIT 50`,
  ]);
  const mineAt = new Map(mine.map((l) => [l.toUserId, l.created_at]));
  const items: FeedItem[] = likes.map((l) => {
    const back = mineAt.get(l.fromUserId);
    if (back) { const at = back > l.created_at ? back : l.created_at; return { kind: "match", text: "💞 إعجاب متبادل جديد — ابدأ المحادثة من «محادثاتي»", at: at.toISOString() }; }
    return { kind: "like", text: "💌 أعجب بك عضو جديد — شاهده في «من أعجب بي»", at: l.created_at.toISOString() };
  });
  for (const s of stored) items.push({ kind: s.kind, text: s.text, at: s.created_at.toISOString() });
  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 60);
}

// ---- 📢 one-shot «update your profile» broadcast (admin-triggered, idempotent per user) -----------
export const UPDATE_CAMPAIGN = "app_launch_2026_10";
export const UPDATE_BROADCAST_TEXT =
  "💍 أخبار سارّة!\n\n" +
  "طوّرنا البوت وافتتحنا قسم «التطبيق» (Mini App): بطاقات تعارف احترافية، محادثات منظّمة، وإشعارات فورية — كل ذلك داخل تلجرام.\n\n" +
  "✨ لتجربة أفضل ونتائج أدق، نرجو تحديث ملفك الشخصي (الصورة، العمل، التعليم، والمواصفات) من الزر أدناه.";

export async function updateBroadcastAudience(botId: string, excludeId?: string): Promise<{ total: number; pending: number }> {
  await ensureMatchAppTables();
  const users = await prisma.matchUser.findMany({ where: { botId, isBanned: false, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } });
  const done = await prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM match_broadcast_log WHERE campaign = ${UPDATE_CAMPAIGN}`;
  const doneSet = new Set(done.map((d) => d.user_id));
  return { total: users.length, pending: users.filter((u) => !doneSet.has(u.id)).length };
}

/** Sends to users not yet logged for this campaign (≈20 msg/s), max `budgetMs` per call. Re-run continues where it stopped. */
export async function runUpdateBroadcast(bot: TelegramBot, botId: string, appUrl: string, excludeId?: string, budgetMs = 22_000) {
  await ensureMatchAppTables();
  const users = await prisma.matchUser.findMany({ where: { botId, isBanned: false, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } });
  const done = new Set((await prisma.$queryRaw<{ user_id: string }[]>`SELECT user_id FROM match_broadcast_log WHERE campaign = ${UPDATE_CAMPAIGN}`).map((d) => d.user_id));
  const kb = new InlineKeyboard().webApp("✏️ حدّث ملفي في التطبيق", `${appUrl}?tab=me`);
  const start = Date.now();
  let delivered = 0, failed = 0, remaining = 0;
  for (const u of users) {
    if (done.has(u.id)) continue;
    if (Date.now() - start > budgetMs) { remaining++; continue; }
    // Claim first so two parallel presses can never message the same user twice.
    const claimed = await prisma.$executeRaw`INSERT INTO match_broadcast_log (campaign, user_id, ok) VALUES (${UPDATE_CAMPAIGN}, ${u.id}, false) ON CONFLICT DO NOTHING`;
    if (!claimed) continue;
    const okSend = await bot.api.sendMessage(Number(u.id), UPDATE_BROADCAST_TEXT, { reply_markup: kb }).then(() => true).catch(() => false);
    if (okSend) { delivered++; await prisma.$executeRaw`UPDATE match_broadcast_log SET ok = true WHERE campaign = ${UPDATE_CAMPAIGN} AND user_id = ${u.id}`; }
    else failed++;
    await new Promise((r) => setTimeout(r, 50));
  }
  const totals = await prisma.$queryRaw<{ ok: boolean; n: bigint }[]>`SELECT ok, count(*) AS n FROM match_broadcast_log WHERE campaign = ${UPDATE_CAMPAIGN} GROUP BY ok`;
  const t = { delivered: 0, failed: 0 };
  for (const x of totals) { if (x.ok) t.delivered = Number(x.n); else t.failed = Number(x.n); }
  return { delivered, failed, remaining, totalDelivered: t.delivered, totalFailed: t.failed, audience: users.length };
}
