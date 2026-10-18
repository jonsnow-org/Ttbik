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
  await adoptZnbt(next.coins).catch(() => null);   // ZNBt's own address and launch time are picked up from the chain, no human step
  return next;
}

// ---- abuse reports ----
export const REPORT_REASONS = ["scam", "impersonation", "illegal", "copyright", "spam", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const isReason = (x: unknown): x is ReportReason => typeof x === "string" && (REPORT_REASONS as readonly string[]).includes(x);
