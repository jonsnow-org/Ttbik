import { prisma } from "@/lib/prisma";

/**
 * 🤝 Revenue-share of the "watch & earn" promo network (AD_BOT), read-only (2026-11-10).
 * Every completed task splits the advertiser's CPC. The splits are already written to the ledger by adBotLogic:
 * - worker 50% → TASK_REWARD;
 * - supervisor (bot creator) 20% → CREATOR_EARNING_PENDING, which matures into Bot.ownerBalance after the 48h hold;
 * - inviter 5% → REFERRAL_COMMISSION;
 * - platform remainder → PLATFORM_PROFIT.
 * This report adds them up per supervisor and in total, so commissions can be checked against what advertisers paid.
 */
export const SPLIT_TYPES = ["AD_PAYMENT", "TASK_REWARD", "CREATOR_EARNING_PENDING", "REFERRAL_COMMISSION", "REFERRAL_B2B_COMMISSION", "PLATFORM_PROFIT", "OWNER_WITHDRAWAL", "AD_REFUND"] as const;
export type SplitType = (typeof SPLIT_TYPES)[number];

export type SupervisorRow = { botId: string; ownerId: string; active: boolean; ready: number; pending: number; earned30d: number; tasks30d: number };
export type CommissionReport = { days: number; totals: Record<SplitType, number>; tasks: number; supervisors: SupervisorRow[]; consistent: boolean };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Pure: per-type totals and a sanity check (paid out ≤ what advertisers spent; a 1¢ rounding tolerance per 100 tasks). */
export function summarizeSplits(rows: { type: string; amount: number; botId: string | null }[], bots: { id: string; ownerId: string; isActive: boolean; ownerBalance: number; pendingBalance: number }[], days: number): CommissionReport {
  const totals = Object.fromEntries(SPLIT_TYPES.map((t) => [t, 0])) as Record<SplitType, number>;
  const perBot = new Map<string, { earned: number; tasks: number }>();
  let tasks = 0;
  for (const r of rows) {
    if ((SPLIT_TYPES as readonly string[]).includes(r.type)) totals[r.type as SplitType] += Number(r.amount) || 0;
    if (r.type === "TASK_REWARD") tasks++;
    if (r.botId && (r.type === "CREATOR_EARNING_PENDING" || r.type === "TASK_REWARD")) {
      const b = perBot.get(r.botId) ?? { earned: 0, tasks: 0 };
      if (r.type === "CREATOR_EARNING_PENDING") b.earned += Number(r.amount) || 0;
      else b.tasks++;
      perBot.set(r.botId, b);
    }
  }
  for (const k of SPLIT_TYPES) totals[k] = r2(totals[k]);
  const paidOut = totals.TASK_REWARD + totals.CREATOR_EARNING_PENDING + totals.REFERRAL_COMMISSION + totals.REFERRAL_B2B_COMMISSION + totals.PLATFORM_PROFIT;
  const spent = totals.AD_PAYMENT;
  const supervisors = bots
    .map((b) => ({ botId: b.id, ownerId: b.ownerId, active: b.isActive, ready: r2(b.ownerBalance), pending: r2(b.pendingBalance), earned30d: r2(perBot.get(b.id)?.earned ?? 0), tasks30d: perBot.get(b.id)?.tasks ?? 0 }))
    .sort((a, b) => b.earned30d - a.earned30d || b.ready + b.pending - (a.ready + a.pending));
  return { days, totals, tasks, supervisors, consistent: spent === 0 ? paidOut === 0 : paidOut <= spent + 0.01 * Math.max(1, tasks / 100) };
}

export async function commissionReport(days = 30): Promise<CommissionReport> {
  const since = new Date(Date.now() - days * 86400_000);
  const [rows, bots] = await Promise.all([
    prisma.transaction.findMany({ where: { created_at: { gte: since }, type: { in: [...SPLIT_TYPES] } }, select: { type: true, amount: true, botId: true }, take: 100000 }).catch(() => []),
    prisma.bot.findMany({ where: { template: "AD_BOT" }, select: { id: true, ownerId: true, isActive: true, ownerBalance: true, pendingBalance: true } }).catch(() => []),
  ]);
  return summarizeSplits(rows, bots, days);
}
