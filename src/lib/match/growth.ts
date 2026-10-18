/**
 * Growth helpers for MARRIAGE_BOT (bot + Mini App), additive (2026-10-14):
 *  - conversion funnel events (match_funnel_events) + admin summary
 *  - renewal reminders EXPIRY_REMINDER_DAYS before VIP / anon-filters expiry (sweeper, once per period)
 */
import { Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { ensureMatchAppTables } from "@/lib/match/appStore";
import { EXPIRY_REMINDER_DAYS, PRICE_ANON_FILTERS, PRICE_VIP_30D } from "@/lib/match/entitlementRules";

export const FUNNEL_EVENTS = ["app_open", "upgrades_view", "purchase_attempt", "purchase_insufficient", "purchase_success", "stars_invoice", "stars_paid", "rewind", "reminder_sent", "athar_arrival", "athar_click"] as const;
export type FunnelEvent = (typeof FUNNEL_EVENTS)[number];

/** Fire-and-forget; never throws into the caller. */
export async function trackFunnel(userId: string, event: FunnelEvent, detail?: string, via: "app" | "bot" = "app"): Promise<void> {
  try {
    await ensureMatchAppTables();
    await prisma.$executeRaw`INSERT INTO match_funnel_events (user_id, event, detail, via) VALUES (${userId}, ${event}, ${detail ?? null}, ${via})`;
  } catch { /* analytics must never break a purchase */ }
}

/** Distinct users + total events per step over the last `days` days, in funnel order. */
export async function funnelSummary(days = 7): Promise<{ event: string; users: number; events: number }[]> {
  await ensureMatchAppTables();
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await prisma.$queryRaw<{ event: string; users: bigint; events: bigint }[]>`
    SELECT event, COUNT(DISTINCT user_id) AS users, COUNT(*) AS events FROM match_funnel_events WHERE created_at >= ${since} GROUP BY event`;
  const by = new Map(rows.map((r) => [r.event, r]));
  return FUNNEL_EVENTS.map((e) => ({ event: e, users: Number(by.get(e)?.users ?? 0), events: Number(by.get(e)?.events ?? 0) }));
}

export function reminderWindow(now = new Date()) {
  return { from: now, to: new Date(now.getTime() + EXPIRY_REMINDER_DAYS * 86400_000) };
}

/** Sends at most one reminder per user/feature/expiry date. Returns how many were sent. */
export async function sweepExpiryReminders(now = new Date()): Promise<number> {
  await ensureMatchAppTables();
  const { from, to } = reminderWindow(now);
  const vip = await prisma.matchUser.findMany({ where: { vipUntil: { gt: from, lte: to }, isBanned: false }, select: { id: true, vipUntil: true }, take: 200 });
  const anon = await prisma.$queryRaw<{ user_id: string; paid_until: Date }[]>`
    SELECT user_id, paid_until FROM match_anon_filters WHERE paid_until > ${from} AND paid_until <= ${to} LIMIT 200`;
  const items = [
    ...vip.map((u) => ({ userId: u.id, kind: "vip", until: u.vipUntil!, text: `⏰ عضويتك الذهبية تنتهي في ${u.vipUntil!.toLocaleDateString("ar")}.\nجدّدها ($${PRICE_VIP_30D}) من «⭐ الترقيات والمزايا» ← «👑 العضوية الذهبية» أو من التطبيق لتبقى مزاياك (الرفع، التخفي، الفلاتر).` })),
    ...anon.map((r) => ({ userId: r.user_id, kind: "anonFilters", until: r.paid_until, text: `⏰ فلاتر الدردشة العشوائية تنتهي في ${r.paid_until.toLocaleDateString("ar")}.\nجدّدها ($${PRICE_ANON_FILTERS} / 30 يوماً) من «⭐ الترقيات والمزايا» أو من التطبيق.` })),
  ];
  let sent = 0;
  const bots = new Map<string, TelegramBot | null>();
  const botFor = async (userId: string) => {
    const u = await prisma.matchUser.findUnique({ where: { id: userId }, select: { botId: true } });
    if (!u) return null;
    if (!bots.has(u.botId)) { const b = await prisma.bot.findUnique({ where: { id: u.botId } }); bots.set(u.botId, b ? new TelegramBot(b.token) : null); }
    return bots.get(u.botId) ?? null;
  };
  for (const it of items) {
    const bot = await botFor(it.userId);
    if (!bot) continue;
    const day = it.until.toISOString().slice(0, 10);
    const claimed = await prisma.$executeRaw`INSERT INTO match_expiry_reminders (user_id, kind, until_day) VALUES (${it.userId}, ${it.kind}, ${day}) ON CONFLICT DO NOTHING`;
    if (claimed !== 1) continue;
    const ok = await bot.api.sendMessage(Number(it.userId), it.text).then(() => true, () => false);
    if (ok) { sent++; void trackFunnel(it.userId, "reminder_sent", it.kind, "bot"); }
  }
  return sent;
}
