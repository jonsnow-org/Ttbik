// The coin index of the open ZNBt platform: one snapshot in our database, refreshed by a cron, served to every visitor.
// (Reading the chain from each visitor's browser through a keyless endpoint cannot carry real traffic.) Also the abuse reports.
import { prisma } from "@/lib/prisma";
import { BASE as cfg, adoptZnbt } from "@/lib/znbtConfig";
import type { Snapshot } from "./vendor/znbtIndexer.cjs";

export type { Snapshot, IndexedCoin } from "./vendor/znbtIndexer.cjs";
export const STALE_SECONDS = 15 * 60;

let ready: Promise<void> | null = null;
export function ensureIndexTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS znbt_index (id INT PRIMARY KEY, snapshot TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS znbt_reports (id BIGSERIAL PRIMARY KEY, curve TEXT NOT NULL, reason TEXT NOT NULL, details TEXT, ip_hash TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS znbt_reports_curve ON znbt_reports(curve)`);
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS znbt_ticks (curve TEXT NOT NULL, ts INT NOT NULL, raised TEXT NOT NULL, tpt TEXT NOT NULL, PRIMARY KEY (curve, ts))`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

export async function readSnapshot(): Promise<Snapshot | null> {
  await ensureIndexTables();
  const rows = (await prisma.$queryRawUnsafe(`SELECT snapshot FROM znbt_index WHERE id=1`)) as { snapshot: string }[];
  try { return rows[0] ? (JSON.parse(rows[0].snapshot) as Snapshot) : null; } catch { return null; }
}
export const isStale = (s: Snapshot | null, now = Date.now()) => !s || now / 1000 - s.updatedAt > STALE_SECONDS;

/** One refresh run (called by the cron): new launches first, then the oldest statistics, inside the time budget. */
export async function refreshSnapshot(budgetMs = 45_000): Promise<Snapshot> {
  const { refreshIndex } = await import("./vendor/znbtIndexer.cjs");
  const prev = await readSnapshot();
  const next = await refreshIndex({ master: cfg.master, prev, apiKey: process.env.TONCENTER_API_KEY || undefined, budgetMs });
  await prisma.$executeRawUnsafe(`INSERT INTO znbt_index (id, snapshot, updated_at) VALUES (1,$1,now()) ON CONFLICT (id) DO UPDATE SET snapshot=EXCLUDED.snapshot, updated_at=now()`, JSON.stringify(next));
  await recordTicks(next.coins).catch(() => null);   // price history for the charts and the 24h change
  await import("@/lib/znbtEngage").then((m) => m.runAlerts(next)).catch((e) => console.error("[znbt-alerts]", e));   // opt-in coin alerts via the platform bot
  await adoptZnbt(next.coins).catch(() => null);   // ZNBt's own address and launch time are picked up from the chain, no human step
  return next;
}

// ---- abuse reports ----
export const REPORT_REASONS = ["scam", "impersonation", "illegal", "copyright", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const isReason = (x: unknown): x is ReportReason => typeof x === "string" && (REPORT_REASONS as readonly string[]).includes(x);


// ---- price history: one tick per coin each time its live numbers were refreshed (at most one per 10 minutes), kept 30 days ----
export async function recordTicks(coins: Snapshot["coins"]): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  for (const c of coins) {
    if (!c.statsAt || c.raisedNano === undefined || !c.tokensPerTon) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO znbt_ticks (curve, ts, raised, tpt) SELECT $1,$2,$3,$4 WHERE NOT EXISTS (SELECT 1 FROM znbt_ticks WHERE curve=$1 AND ts > $2 - 600)`,
      c.curve, c.statsAt, c.raisedNano, c.tokensPerTon,
    );
  }
  await prisma.$executeRawUnsafe(`DELETE FROM znbt_ticks WHERE ts < $1`, now - 30 * 86400);
}
export type Tick = { ts: number; raised: string; tpt: string };
export async function ticksOf(curve: string, days = 7, max = 240): Promise<Tick[]> {
  await ensureIndexTables();
  const rows = (await prisma.$queryRawUnsafe(`SELECT ts, raised, tpt FROM znbt_ticks WHERE curve=$1 AND ts > $2 ORDER BY ts`, curve, Math.floor(Date.now() / 1000) - days * 86400)) as Tick[];
  if (rows.length <= max) return rows;
  const step = rows.length / max;
  return Array.from({ length: max }, (_, i) => rows[Math.min(rows.length - 1, Math.floor(i * step))]).concat(rows[rows.length - 1]);
}
/** Per coin: the numbers 24 hours ago (the oldest tick inside that window), to compute the 24h change next to the live numbers. */
export async function baselines24h(): Promise<Record<string, { raised: string; tpt: string }>> {
  await ensureIndexTables();
  const rows = (await prisma.$queryRawUnsafe(`SELECT DISTINCT ON (curve) curve, raised, tpt FROM znbt_ticks WHERE ts > $1 ORDER BY curve, ts ASC`, Math.floor(Date.now() / 1000) - 86400)) as { curve: string; raised: string; tpt: string }[];
  return Object.fromEntries(rows.map((r) => [r.curve, { raised: r.raised, tpt: r.tpt }]));
}
