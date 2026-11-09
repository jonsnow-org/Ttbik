import { prisma } from "@/lib/prisma";

/**
 * 💵 Real money vs internal credit (2026-11-10).
 *
 * Real money is what an outside provider confirmed:
 * - a DEPOSIT row that carries a provider id (txHash: NOWPayments payment_id, Telegram Stars charge id, TON/TRC20 hash);
 * - a PAID site banner;
 * - an ACTIVE/EXPIRED Nova subscription;
 * - an APPROVED/REDEEMED bot purchase;
 * - a RELEASED store order.
 * Everything else (internal balance spends, rewards, referral bonuses, owner-credited deposits without a provider id) is internal credit:
 * useful for engagement, but it is not revenue.
 */
export type RevenueRow = { source: string; currency: string; amount: number; count: number; real: boolean };
export type RevenueReport = {
  days: number;
  realUsd: number;
  realCount: number;
  internalUsd: number;
  internalCount: number;
  bySource: RevenueRow[];
  lastRealAt: string | null;
};

export function isRealDeposit(r: { type: string; status?: string | null; txHash?: string | null }): boolean {
  return r.type === "DEPOSIT" && (r.status ?? "COMPLETED") === "COMPLETED" && !!r.txHash;
}

/** Pure aggregation, unit-tested: rows in, report out. Amounts are USD-equivalent (Stars at 100 = $1). */
export function summarize(days: number, rows: (RevenueRow & { at?: Date | null })[]): RevenueReport {
  const key = (r: RevenueRow) => `${r.real ? 1 : 0}|${r.source}|${r.currency}`;
  const m = new Map<string, RevenueRow>();
  let lastReal: Date | null = null;
  for (const r of rows) {
    if (!(r.amount > 0) || !(r.count > 0)) continue;
    const k = key(r);
    const cur = m.get(k) ?? { source: r.source, currency: r.currency, amount: 0, count: 0, real: r.real };
    cur.amount += r.amount;
    cur.count += r.count;
    m.set(k, cur);
    if (r.real && r.at && (!lastReal || r.at > lastReal)) lastReal = r.at;
  }
  const bySource = [...m.values()].map((r) => ({ ...r, amount: Math.round(r.amount * 100) / 100 })).sort((a, b) => Number(b.real) - Number(a.real) || b.amount - a.amount);
  const sum = (real: boolean) => bySource.filter((r) => r.real === real).reduce((s, r) => s + r.amount, 0);
  const cnt = (real: boolean) => bySource.filter((r) => r.real === real).reduce((s, r) => s + r.count, 0);
  return {
    days,
    realUsd: Math.round(sum(true) * 100) / 100,
    realCount: cnt(true),
    internalUsd: Math.round(sum(false) * 100) / 100,
    internalCount: cnt(false),
    bySource,
    lastRealAt: lastReal ? lastReal.toISOString() : null,
  };
}

type Ledger = { type: string; currency: string; status: string | null; txHash: string | null; amount: number; created_at: Date };

function ledgerRows(source: string, rows: Ledger[]): (RevenueRow & { at: Date })[] {
  return rows.map((r) => ({ source: `${source} · ${r.type}`, currency: r.currency, amount: Number(r.amount) || 0, count: 1, real: isRealDeposit(r), at: r.created_at }));
}

export async function revenueReport(days = 30): Promise<RevenueReport> {
  const since = new Date(Date.now() - days * 86400_000);
  const sel = { type: true, currency: true, status: true, txHash: true, amount: true, created_at: true } as const;
  const where = { created_at: { gte: since } };
  const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
  const [wallet, match, jobs, confession, banners, nova, botBuys, orders] = await Promise.all([
    safe(prisma.transaction.findMany({ where, select: sel, take: 20000 })),
    safe(prisma.matchTransaction.findMany({ where, select: sel, take: 20000 })),
    safe(prisma.jobsTransaction.findMany({ where, select: sel, take: 20000 }) as Promise<Ledger[]>),
    safe(prisma.confessionTransaction.findMany({ where, select: sel, take: 20000 }) as Promise<Ledger[]>),
    safe(prisma.siteBannerAd.findMany({ where: { createdAt: { gte: since }, paymentStatus: "PAID" }, select: { totalPrice: true, createdAt: true } })),
    safe(prisma.novaSubscription.findMany({ where: { created_at: { gte: since }, status: { in: ["ACTIVE", "EXPIRED"] } }, select: { amountUsd: true, created_at: true } })),
    safe(prisma.botPurchase.findMany({ where: { created_at: { gte: since }, status: { in: ["APPROVED", "REDEEMED"] } }, select: { amount: true, created_at: true } })),
    safe(prisma.storeOrder.findMany({ where: { created_at: { gte: since }, status: "RELEASED" }, select: { amount: true, created_at: true } })),
  ]);
  return summarize(days, [
    ...ledgerRows("المحفظة/الإعلانات", wallet as Ledger[]),
    ...ledgerRows("بوت الزواج", match as Ledger[]),
    ...ledgerRows("بوت الوظائف", jobs),
    ...ledgerRows("بوت الاعترافات", confession),
    ...banners.map((b) => ({ source: "بنرات الموقع", currency: "USD", amount: b.totalPrice, count: 1, real: true, at: b.createdAt })),
    ...nova.map((n) => ({ source: "اشتراك نوفا", currency: "USD", amount: n.amountUsd, count: 1, real: true, at: n.created_at })),
    ...botBuys.map((b) => ({ source: "شراء بوت", currency: "USD", amount: b.amount, count: 1, real: true, at: b.created_at })),
    ...orders.map((o) => ({ source: "طلبات المتجر", currency: "USD", amount: o.amount, count: 1, real: true, at: o.created_at })),
  ]);
}
