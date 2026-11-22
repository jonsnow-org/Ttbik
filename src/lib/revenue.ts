import { prisma } from "@/lib/prisma";

export type RevenueCategory =
  | "platform_sale" | "platform_fee" | "customer_topup" | "customer_spend"
  | "seller_volume" | "seller_payable" | "escrow" | "pending_sale" | "pending_fee" | "internal";
export type RevenueUnit = "USD" | "USD_EQ" | "RAW";
export type RevenueEvidence =
  | "provider_reference" | "system_recorded" | "admin_approved" | "internal_ledger" | "unverified";
export type RevenueRow = {
  source: string; category: RevenueCategory; currency: string; unit: RevenueUnit;
  evidence: RevenueEvidence; amount: number; count: number; at?: Date | null; real?: boolean;
};
type LegacyRevenueRow = { source: string; currency: string; amount: number; count: number; real: boolean; at?: Date | null };
export type RevenueReport = {
  days: number; platformSalesUsd: number; platformFeesUsd: number; grossPlatformRevenueUsd: number;
  platformRevenueEquivalentUsd: number; customerTopupsUsdEq: number; customerSpendUsdEq: number;
  sellerVolumeUsd: number; creatorPayablesUsdEq: number; escrowOutstandingUsd: number; pendingSalesUsd: number; pendingFeesUsd: number;
  internalByCurrency: { currency: string; amount: number; count: number }[];
  bySource: RevenueRow[]; incompleteSources: string[];
  pendingFeesUsdEq: number;
  lastPlatformReceiptAt: string | null; lastCustomerTopupAt: string | null;
  // Backwards-compatible fields for existing payment flows/tests.
  realUsd: number; realCount: number; internalUsd: number; internalCount: number; lastRealAt: string | null;
  netProfitComputed: false;
};

const roundMoney = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const internalCurrency = (v: string) => String(v || "").trim().toLowerCase() === "internal";

/** Historical API used by payment webhooks and accounting tests. */
export function isRealDeposit(r: { type: string; status?: string | null; txHash?: string | null }): boolean {
  return r.type === "DEPOSIT" && (r.status ?? "COMPLETED") === "COMPLETED" && !!String(r.txHash || "").trim();
}

/** A completed external deposit is customer funding, never platform income. */
export function isVerifiedTopUp(r: { type: string; status?: string | null; txHash?: string | null; currency?: string | null }) {
  return isRealDeposit(r) && !internalCurrency(String(r.currency || ""));
}

type Ledger = { type: string; currency: string; status: string | null; txHash: string | null; amount: number; created_at: Date };

/** Classifies existing isolated ledgers without mixing wallet liabilities into revenue. */
export function ledgerRows(source: string, rows: Ledger[]): RevenueRow[] {
  return rows.map((r) => {
    const currency = String(r.currency || "unknown"), amount = Number(r.amount) || 0;
    const base = { count: 1, at: r.created_at };
    if (isVerifiedTopUp(r)) return {
      ...base, source: `${source} · شحن رصيد`, category: "customer_topup", currency: "USD-equivalent",
      unit: "USD_EQ", evidence: "provider_reference", amount,
    };
    if ((source === "بوت الوظائف" && r.type === "PLATFORM_FEE" && r.status === "COMPLETED") ||
        (source === "بوت الإعلانات" && r.type === "PLATFORM_PROFIT" && r.status === "COMPLETED")) return {
      ...base, source: `${source} · عمولة دفترية`, category: "platform_fee", currency: "USD-equivalent",
      unit: "USD_EQ", evidence: "internal_ledger", amount,
    };
    if (source === "بوت الإعلانات" && r.type === "CREATOR_EARNING_PENDING") return {
      ...base, source: `${source} · مستحق مالك البوت`, category: "seller_payable", currency: "USD-equivalent",
      unit: "USD_EQ", evidence: "internal_ledger", amount,
    };
    if (source === "بوت الوظائف" && r.type === "PLATFORM_FEE_PENDING") return {
      ...base, source: `${source} · عمولة قيد التسوية`, category: "pending_fee", currency: "USD-equivalent",
      unit: "USD_EQ", evidence: "internal_ledger", amount,
    };
    if ((source === "بوت المطابقة" && !["DEPOSIT", "REFERRAL_REWARD", "MATCHMAKER_REFUND"].includes(r.type)) ||
        (source === "بوت الاعترافات" && r.type !== "DEPOSIT")) return {
      ...base, source: `${source} · استخدام من الرصيد`, category: "customer_spend", currency: "USD-equivalent",
      unit: "USD_EQ", evidence: "internal_ledger", amount,
    };
    return {
      ...base, source: `${source} · ${r.type}`, category: "internal", currency,
      unit: "RAW", evidence: internalCurrency(currency) ? "unverified" : "internal_ledger", amount,
    };
  });
}

export function summarize(days: number, inputRows: (RevenueRow | LegacyRevenueRow)[], incompleteSources: string[] = []): RevenueReport {
  // Preserve the pre-existing summarize(source,currency,amount,count,real) contract
  // while all current revenue code uses explicit categories, units and evidence.
  const rows: RevenueRow[] = inputRows.map((row) => {
    if ("category" in row) return row;
    const currency = String(row.currency || "unknown");
    return {
      source: row.source,
      category: row.real ? (currency.toLowerCase() === "usd" ? "platform_sale" : "customer_topup") : "internal",
      currency,
      unit: row.real ? (currency.toLowerCase() === "usd" ? "USD" : "USD_EQ") : "RAW",
      evidence: row.real ? (currency.toLowerCase() === "usd" ? "system_recorded" : "provider_reference") : "internal_ledger",
      amount: row.amount,
      count: row.count,
      at: row.at,
      real: row.real,
    };
  });

  const map = new Map<string, RevenueRow>();
  for (const row of rows) {
    if (!Number.isFinite(row.amount) || row.amount <= 0 || !Number.isFinite(row.count) || row.count <= 0) continue;
    const key = [row.category, row.source, row.currency, row.unit, row.evidence].join("|");
    const current = map.get(key) ?? { ...row, amount: 0, count: 0 };
    current.amount += row.amount; current.count += row.count;
    if (row.at && (!current.at || row.at > current.at)) current.at = row.at;
    map.set(key, current);
  }
  const bySource = [...map.values()].map((r) => ({
    ...r, amount: roundMoney(r.amount),
    real: r.real ?? (["provider_reference", "system_recorded", "admin_approved"].includes(r.evidence) &&
      ["platform_sale", "platform_fee", "customer_topup"].includes(r.category)),
  })).sort((a, b) => b.amount - a.amount || a.source.localeCompare(b.source));
  const sum = (category: RevenueCategory, unit: RevenueUnit) =>
    roundMoney(bySource.filter((r) => r.category === category && r.unit === unit).reduce((n, r) => n + r.amount, 0));
  const last = (categories: RevenueCategory[], unit: RevenueUnit) => {
    const dates = bySource.filter((r) => categories.includes(r.category) && r.unit === unit && r.at).map((r) => r.at!.getTime());
    return dates.length ? new Date(Math.max(...dates)).toISOString() : null;
  };
  const internal = new Map<string, { amount: number; count: number }>();
  for (const row of bySource.filter((r) => r.unit === "RAW")) {
    const old = internal.get(row.currency) ?? { amount: 0, count: 0 };
    old.amount += row.amount; old.count += row.count; internal.set(row.currency, old);
  }
  const platformSalesUsd = sum("platform_sale", "USD"), platformFeesUsd = sum("platform_fee", "USD");
  const realRows = bySource.filter((r) => r.real);
  const internalRows = bySource.filter((r) => !r.real && r.unit === "RAW");
  const realUsd = roundMoney(realRows.reduce((n, r) => n + r.amount, 0));
  const internalUsd = roundMoney(internalRows.reduce((n, r) => n + r.amount, 0));
  const lastRealDates = realRows.filter((r) => r.at).map((r) => r.at!.getTime());
  return {
    days, platformSalesUsd, platformFeesUsd,
    grossPlatformRevenueUsd: roundMoney(platformSalesUsd + platformFeesUsd),
    platformRevenueEquivalentUsd: roundMoney(sum("platform_sale", "USD_EQ") + sum("platform_fee", "USD_EQ")),
    customerTopupsUsdEq: sum("customer_topup", "USD_EQ"),
    customerSpendUsdEq: sum("customer_spend", "USD_EQ"),
    sellerVolumeUsd: sum("seller_volume", "USD"), creatorPayablesUsdEq: sum("seller_payable", "USD_EQ"),
    escrowOutstandingUsd: sum("escrow", "USD"),
    pendingSalesUsd: sum("pending_sale", "USD"), pendingFeesUsd: sum("pending_fee", "USD"),
    pendingFeesUsdEq: sum("pending_fee", "USD_EQ"),
    internalByCurrency: [...internal.entries()].map(([currency, v]) => ({ currency, amount: roundMoney(v.amount), count: v.count }))
      .sort((a, b) => b.amount - a.amount),
    bySource, incompleteSources: [...new Set(incompleteSources)],
    lastPlatformReceiptAt: last(["platform_sale", "platform_fee"], "USD"),
    lastCustomerTopupAt: last(["customer_topup"], "USD_EQ"),
    realUsd,
    realCount: realRows.reduce((n, r) => n + r.count, 0),
    internalUsd,
    internalCount: internalRows.reduce((n, r) => n + r.count, 0),
    lastRealAt: lastRealDates.length ? new Date(Math.max(...lastRealDates)).toISOString() : null,
    netProfitComputed: false,
  };
}

type Banner = { totalPrice: number; paymentStatus: string; adStatus: string; createdAt: Date; kind: string };
type Subscription = { amountUsd: number; status: string; created_at: Date };
type BotPurchase = { amount: number; status: string; transferReference: string | null; created_at: Date };
type Order = { amount: number; created_at: Date };
type ChannelDeal = { kind: string; status: string; price: unknown; commission: unknown; payout: unknown; created_at: Date; paid_at: Date | null };
type Sponsor = { price: unknown; status: string; paid_via: string | null; created_at: Date };
type RemitPayment = { price: unknown; at: Date };
type RemitListing = { price: unknown; status: string; paid_via: string | null; created_at: Date };

export async function revenueReport(days = 30): Promise<RevenueReport> {
  const safeDays = Math.min(365, Math.max(1, Math.floor(Number(days) || 30)));
  const since = new Date(Date.now() - safeDays * 86400_000);
  const where = { created_at: { gte: since } };
  const select = { type: true, currency: true, status: true, txHash: true, amount: true, created_at: true } as const;
  const incomplete: string[] = [];
  async function read<T>(label: string, promise: Promise<T>): Promise<T> {
    try { return await promise; } catch { incomplete.push(label); return [] as T; }
  }

  const [
    wallet, match, jobs, confession, banners, nova, botBuys, releasedOrders, escrowedOrders,
    channelDeals, sponsors, remitPayments, remitListings,
  ] = await Promise.all([
    read("دفتر المحفظة", prisma.transaction.findMany({ where, select, take: 20000 }) as Promise<Ledger[]>),
    read("دفتر المطابقة", prisma.matchTransaction.findMany({ where, select, take: 20000 }) as Promise<Ledger[]>),
    read("دفتر الوظائف", prisma.jobsTransaction.findMany({ where, select, take: 20000 }) as Promise<Ledger[]>),
    read("دفتر الاعترافات", prisma.confessionTransaction.findMany({ where, select, take: 20000 }) as Promise<Ledger[]>),
    read("بنرات الموقع", prisma.siteBannerAd.findMany({
      where: { createdAt: { gte: since } }, select: { totalPrice: true, paymentStatus: true, adStatus: true, createdAt: true, kind: true }, take: 20000,
    }) as Promise<Banner[]>),
    read("اشتراكات نوفا المسجلة", prisma.novaSubscription.findMany({
      where: { created_at: { gte: since } }, select: { amountUsd: true, status: true, created_at: true }, take: 20000,
    }) as Promise<Subscription[]>),
    read("طلبات شراء البوتات", prisma.botPurchase.findMany({
      where: { created_at: { gte: since } }, select: { amount: true, status: true, transferReference: true, created_at: true }, take: 20000,
    }) as Promise<BotPurchase[]>),
    read("طلبات المتجر المحررة", prisma.storeOrder.findMany({
      where: { created_at: { gte: since }, status: "RELEASED" }, select: { amount: true, created_at: true }, take: 20000,
    }) as Promise<Order[]>),
    read("الأموال المحجوزة للمتجر", prisma.storeOrder.findMany({
      where: { created_at: { gte: since }, status: "ESCROWED" }, select: { amount: true, created_at: true }, take: 20000,
    }) as Promise<Order[]>),
    read("صفقات القنوات", prisma.$queryRawUnsafe<ChannelDeal[]>(
      "SELECT kind, status, price, commission, payout, created_at, paid_at FROM channel_deals WHERE created_at >= $1", since,
    )),
    read("رعايات الختمات والمسابقات", prisma.$queryRawUnsafe<Sponsor[]>(
      "SELECT price, status, paid_via, created_at FROM khatma_sponsors WHERE created_at >= $1", since,
    )),
    read("مدفوعات إدراج شركات الحوالات", prisma.$queryRawUnsafe<RemitPayment[]>(
      "SELECT l.price, p.at FROM remit_payments p JOIN remit_listings l ON l.code = p.code WHERE p.at >= $1", since,
    )),
    read("طلبات إدراج شركات الحوالات", prisma.$queryRawUnsafe<RemitListing[]>(
      "SELECT price, status, paid_via, created_at FROM remit_listings WHERE created_at >= $1", since,
    )),
  ]);

  const rows: RevenueRow[] = [
    ...ledgerRows("بوت الإعلانات", wallet),
    ...ledgerRows("بوت المطابقة", match),
    ...ledgerRows("بوت الوظائف", jobs),
    ...ledgerRows("بوت الاعترافات", confession),
  ];

  for (const b of banners) {
    const amount = Number(b.totalPrice) || 0;
    if (b.paymentStatus === "PAID") rows.push({
      source: `بنرات الموقع · ${b.kind}`, category: "platform_sale", currency: "USD", unit: "USD",
      evidence: "system_recorded", amount, count: 1, at: b.createdAt,
    });
    else if (["PENDING", "PENDING_PAYMENT"].includes(b.paymentStatus) && b.adStatus !== "REJECTED") rows.push({
      source: `بنرات الموقع · ${b.kind}`, category: "pending_sale", currency: "USD", unit: "USD",
      evidence: "unverified", amount, count: 1, at: b.createdAt,
    });
  }

  for (const n of nova) {
    const amount = Number(n.amountUsd) || 0;
    if (["ACTIVE", "EXPIRED"].includes(n.status)) rows.push({
      source: "اشتراكات نوفا · موافقة مسجلة", category: "platform_sale", currency: "USD", unit: "USD",
      evidence: "admin_approved", amount, count: 1, at: n.created_at,
    });
    else if (n.status === "PENDING_APPROVAL") rows.push({
      source: "اشتراكات نوفا · قيد الموافقة", category: "pending_sale", currency: "USD", unit: "USD",
      evidence: "unverified", amount, count: 1, at: n.created_at,
    });
  }

  for (const b of botBuys) {
    const amount = Number(b.amount) || 0;
    if (["APPROVED", "REDEEMED"].includes(b.status)) rows.push({
      source: "شراء بوت · موافقة إدارية", category: "platform_sale", currency: "USD", unit: "USD",
      evidence: "admin_approved", amount, count: 1, at: b.created_at,
    });
    else if (b.status === "PENDING") rows.push({
      source: "شراء بوت · بانتظار المراجعة", category: "pending_sale", currency: "USD", unit: "USD",
      evidence: "unverified", amount, count: 1, at: b.created_at,
    });
  }

  for (const o of releasedOrders) rows.push({
    source: "المتجر · حجم مبيعات البائعين", category: "seller_volume", currency: "USD", unit: "USD",
    evidence: "system_recorded", amount: Number(o.amount) || 0, count: 1, at: o.created_at,
  });
  for (const o of escrowedOrders) rows.push({
    source: "المتجر · أموال محجوزة", category: "escrow", currency: "USD", unit: "USD",
    evidence: "system_recorded", amount: Number(o.amount) || 0, count: 1, at: o.created_at,
  });

  for (const d of channelDeals) {
    const price = Number(d.price) || 0, commission = Number(d.commission) || 0, payout = Number(d.payout) || 0;
    const at = d.paid_at || d.created_at;
    if (d.kind === "BADGE" && d.status === "RELEASED") rows.push({
      source: "القنوات · شارة توثيق", category: "platform_sale", currency: "USD", unit: "USD",
      evidence: "system_recorded", amount: price, count: 1, at,
    });
    else if (d.status === "RELEASED") {
      if (commission > 0) rows.push({
        source: "القنوات · عمولة صفقة محررة", category: "platform_fee", currency: "USD", unit: "USD",
        evidence: "system_recorded", amount: commission, count: 1, at,
      });
      rows.push({
        source: "القنوات · مستحق البائع", category: "seller_volume", currency: "USD", unit: "USD",
        evidence: "system_recorded", amount: payout, count: 1, at,
      });
    } else if (["PAID", "POSTED", "VERIFIED"].includes(d.status)) {
      if (commission > 0) rows.push({
        source: "القنوات · عمولة بانتظار التسوية", category: "pending_fee", currency: "USD", unit: "USD",
        evidence: "system_recorded", amount: commission, count: 1, at,
      });
      rows.push({
        source: "القنوات · صفقة بانتظار الإغلاق", category: "escrow", currency: "USD", unit: "USD",
        evidence: "system_recorded", amount: price, count: 1, at,
      });
    } else if (d.status === "PENDING_PAYMENT") rows.push({
      source: "القنوات · طلب إعلان غير مدفوع", category: "pending_sale", currency: "USD", unit: "USD",
      evidence: "unverified", amount: price, count: 1, at,
    });
  }

  for (const s of sponsors) {
    const amount = Number(s.price) || 0;
    if (s.paid_via) rows.push({
      source: "رعاية الختمات والمسابقات", category: "platform_sale", currency: "USD", unit: "USD",
      evidence: "system_recorded", amount, count: 1, at: s.created_at,
    });
    else if (s.status === "PENDING_PAYMENT") rows.push({
      source: "رعاية الختمات والمسابقات · بانتظار الدفع", category: "pending_sale", currency: "USD", unit: "USD",
      evidence: "unverified", amount, count: 1, at: s.created_at,
    });
  }

  for (const p of remitPayments) rows.push({
    source: "إدراج شركات الحوالات · دفعة ذات مرجع", category: "platform_sale", currency: "USD", unit: "USD",
    evidence: "provider_reference", amount: Number(p.price) || 0, count: 1, at: p.at,
  });
  for (const l of remitListings) if (!l.paid_via && ["APPROVED", "PENDING_REVIEW"].includes(l.status)) rows.push({
    source: "إدراج شركات الحوالات · طلب غير مدفوع", category: "pending_sale", currency: "USD", unit: "USD",
    evidence: "unverified", amount: Number(l.price) || 0, count: 1, at: l.created_at,
  });

  return summarize(safeDays, rows, incomplete);
}
