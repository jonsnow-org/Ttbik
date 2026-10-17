// The ONE path that moves the platform's final profit to the owner's wallet
// (owner wallet = env OWNER_PAYOUT_WALLET, never written in code).
//
// Safety model:
//  - claim-before-send: the profit accumulator is debited and a log row written
//    in ONE database transaction BEFORE anything is broadcast, so a crash or a
//    failed bookkeeping step can never lead to a second transfer of the same money;
//  - a real TON/USD price or no transfer (see getTonUsdRateStrict);
//  - threshold, per-transfer cap and daily cap; anything over a cap waits;
//  - a pause switch (owner bot button) that blocks sweeps; any failed send
//    pauses payouts automatically so the owner looks before anything retries.
// Only the platform's own accumulated profit is ever swept: user balances and
// supervisors' commissions are never touched here.
import { prisma } from "@/lib/prisma";
import { getTonUsdRateStrict, isNativeTonConfigured, isTonAddress, sendTonWithdrawal } from "@/services/ton-service";

export const DEFAULT_THRESHOLD_USD = 15;
export const DEFAULT_PER_TX_CAP_USD = 100;
export const DEFAULT_DAILY_CAP_USD = 200;

export function ownerPayoutAddress(): string | null {
  const a = (process.env.OWNER_PAYOUT_WALLET || process.env.OWNER_CWALLET_ADDRESS || "").trim();
  return a && isTonAddress(a) ? a : null;
}

export type SweepPlan = { ok: true; amountUsd: number; amountTon: number } | { ok: false; reason: string };

/** Pure sizing rule, kept separate so it can be tested without a database. */
export function planSweep(p: { accumulatedUsd: number; thresholdUsd: number; perTxCapUsd: number; dailyCapUsd: number; sentTodayUsd: number; rate: number }): SweepPlan {
  if (!(p.rate > 0)) return { ok: false, reason: "no_rate" };
  if (!(p.accumulatedUsd > p.thresholdUsd)) return { ok: false, reason: "below_threshold" };
  const room = Math.max(0, p.dailyCapUsd - p.sentTodayUsd);
  const amountUsd = Math.floor(Math.min(p.accumulatedUsd, p.perTxCapUsd, room) * 100) / 100;
  if (amountUsd <= 0) return { ok: false, reason: "daily_cap" };
  const amountTon = Math.round((amountUsd / p.rate) * 10000) / 10000;
  if (amountTon <= 0) return { ok: false, reason: "dust" };
  return { ok: true, amountUsd, amountTon };
}

let tablesReady = false;
async function ensureTables() {
  if (tablesReady) return;
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS owner_payout_state (key text PRIMARY KEY, value text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
  await prisma.$executeRawUnsafe(
    `CREATE TABLE IF NOT EXISTS owner_payout_log (id bigserial PRIMARY KEY, amount_usd double precision NOT NULL, amount_ton double precision NOT NULL, rate double precision NOT NULL, to_address text NOT NULL, status text NOT NULL, trigger text NOT NULL, note text, created_at timestamptz NOT NULL DEFAULT now())`
  );
  tablesReady = true;
}

export async function isPayoutsPaused(): Promise<boolean> {
  if (process.env.PAYOUTS_PAUSED === "1") return true;
  await ensureTables();
  const rows = await prisma.$queryRaw<{ value: string }[]>`SELECT value FROM owner_payout_state WHERE key = 'paused'`;
  return rows[0]?.value === "1";
}
export async function setPayoutsPaused(paused: boolean): Promise<void> {
  await ensureTables();
  await prisma.$executeRaw`INSERT INTO owner_payout_state (key, value) VALUES ('paused', ${paused ? "1" : "0"}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

export type OwnerWalletSummary = {
  address: string | null;
  accumulatedUsd: number;
  thresholdUsd: number;
  paused: boolean;
  sentTodayUsd: number;
  sentTotalUsd: number;
  lastFailure: string | null;
};
export async function ownerWalletSummary(): Promise<OwnerWalletSummary> {
  await ensureTables();
  const settings = await prisma.platformSettings.findUnique({ where: { id: 1 } });
  const day = await prisma.$queryRaw<{ s: number | null }[]>`SELECT sum(amount_usd) AS s FROM owner_payout_log WHERE status = 'SENT' AND created_at > now() - interval '24 hours'`;
  const total = await prisma.$queryRaw<{ s: number | null }[]>`SELECT sum(amount_usd) AS s FROM owner_payout_log WHERE status = 'SENT'`;
  const fail = await prisma.$queryRaw<{ note: string | null }[]>`SELECT note FROM owner_payout_log WHERE status = 'FAILED' ORDER BY id DESC LIMIT 1`;
  return {
    address: ownerPayoutAddress(),
    accumulatedUsd: Number(settings?.accumulatedOwnerProfit || 0),
    thresholdUsd: Number(process.env.OWNER_SWEEP_THRESHOLD || DEFAULT_THRESHOLD_USD),
    paused: await isPayoutsPaused(),
    sentTodayUsd: Number(day[0]?.s || 0),
    sentTotalUsd: Number(total[0]?.s || 0),
    lastFailure: fail[0]?.note ?? null,
  };
}

export type SweepResult = { swept: boolean; reason?: string; amountUsd?: number; amountTon?: number; error?: string };

export async function sweepOwnerProfits(opts: { manual: boolean }): Promise<SweepResult> {
  const to = ownerPayoutAddress();
  if (!to) return { swept: false, reason: "no_wallet" };
  if (!isNativeTonConfigured()) return { swept: false, reason: "ton_not_configured" };
  if (await isPayoutsPaused()) return { swept: false, reason: "paused" };

  const sum = await ownerWalletSummary();
  let rate: number;
  try {
    rate = await getTonUsdRateStrict();
  } catch (e: any) {
    return { swept: false, reason: "no_rate", error: e?.message };
  }
  const plan = planSweep({
    accumulatedUsd: sum.accumulatedUsd,
    thresholdUsd: opts.manual ? 0 : sum.thresholdUsd,
    perTxCapUsd: Number(process.env.OWNER_PAYOUT_TX_CAP_USD || DEFAULT_PER_TX_CAP_USD),
    dailyCapUsd: Number(process.env.OWNER_PAYOUT_DAILY_CAP_USD || DEFAULT_DAILY_CAP_USD),
    sentTodayUsd: sum.sentTodayUsd,
    rate,
  });
  if (!plan.ok) return { swept: false, reason: plan.reason };

  // CLAIM: debit the accumulator (only if it still holds the money) and log, atomically.
  const logId = await prisma.$transaction(async (tx) => {
    const r = await tx.platformSettings.updateMany({ where: { id: 1, accumulatedOwnerProfit: { gte: plan.amountUsd } }, data: { accumulatedOwnerProfit: { decrement: plan.amountUsd } } });
    if (r.count !== 1) return null;
    const rows = await tx.$queryRaw<{ id: bigint }[]>`INSERT INTO owner_payout_log (amount_usd, amount_ton, rate, to_address, status, trigger) VALUES (${plan.amountUsd}, ${plan.amountTon}, ${rate}, ${to}, 'CLAIMED', ${opts.manual ? "manual" : "cron"}) RETURNING id`;
    return rows[0].id;
  });
  if (logId === null) return { swept: false, reason: "balance_changed" };

  try {
    await sendTonWithdrawal(to, plan.amountTon);
  } catch (e: any) {
    // Give the money back to the accumulator and stop all payouts until the owner looks:
    // a failure can be ambiguous (e.g. a timeout after broadcast), so nothing retries by itself.
    await prisma.$transaction([
      prisma.platformSettings.update({ where: { id: 1 }, data: { accumulatedOwnerProfit: { increment: plan.amountUsd } } }),
      prisma.$executeRaw`UPDATE owner_payout_log SET status = 'FAILED', note = ${String(e?.message || e).slice(0, 300)} WHERE id = ${logId}`,
    ]);
    await setPayoutsPaused(true);
    return { swept: false, reason: "send_failed", error: e?.message || String(e) };
  }
  await prisma.$executeRaw`UPDATE owner_payout_log SET status = 'SENT' WHERE id = ${logId}`;
  return { swept: true, amountUsd: plan.amountUsd, amountTon: plan.amountTon };
}
