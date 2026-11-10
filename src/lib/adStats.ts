import { prisma } from "@/lib/prisma";
import { signLink, verifyLink } from "@/lib/linkSigning";
import { SITE_URL } from "@/lib/siteUrl";

/**
 * 📊 Proof of promotion for paid site ads (2026-11-10): daily views and clicks per reservation code, so every advertiser
 * gets a private report link. Additive table, created on first use: no migration and nothing dropped.
 */
let ready: Promise<unknown> | null = null;
export function ensureAdStatsTable() {
  ready ??= (async () => {
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS site_ad_stats (code text NOT NULL, day date NOT NULL DEFAULT CURRENT_DATE, views integer NOT NULL DEFAULT 0, clicks integer NOT NULL DEFAULT 0, PRIMARY KEY (code, day))`,
    );
    // server-only table: no policies, so the public Supabase REST keys can neither read nor write it
    await prisma.$executeRawUnsafe(`ALTER TABLE site_ad_stats ENABLE ROW LEVEL SECURITY`);
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

export async function recordAdEvent(code: string, ev: "view" | "click"): Promise<void> {
  try {
    await ensureAdStatsTable();
    if (ev === "view") await prisma.$executeRaw`INSERT INTO site_ad_stats (code, views) VALUES (${code}, 1) ON CONFLICT (code, day) DO UPDATE SET views = site_ad_stats.views + 1`;
    else await prisma.$executeRaw`INSERT INTO site_ad_stats (code, clicks) VALUES (${code}, 1) ON CONFLICT (code, day) DO UPDATE SET clicks = site_ad_stats.clicks + 1`;
  } catch {
    /* stats must never break the ad or the redirect */
  }
}

export type AdDay = { day: string; views: number; clicks: number };
export async function adDailyStats(code: string): Promise<AdDay[]> {
  try {
    await ensureAdStatsTable();
    const rows = await prisma.$queryRaw<{ day: Date; views: number; clicks: number }[]>`SELECT day, views, clicks FROM site_ad_stats WHERE code = ${code} ORDER BY day ASC LIMIT 400`;
    return rows.map((r) => ({ day: new Date(r.day).toISOString().slice(0, 10), views: Number(r.views), clicks: Number(r.clicks) }));
  } catch {
    return [];
  }
}

export function totals(days: AdDay[]) {
  const views = days.reduce((s, d) => s + d.views, 0);
  const clicks = days.reduce((s, d) => s + d.clicks, 0);
  return { views, clicks, ctr: views > 0 ? Math.round((clicks / views) * 1000) / 10 : 0 };
}

/** Private, signed report URL ("" when CRON_SECRET is missing, so no unsigned link is ever handed out). */
export function adReportUrl(code: string): string {
  const s = signLink("adreport", code);
  return s ? `${SITE_URL}/advertise/report?c=${encodeURIComponent(code)}&s=${s}` : "";
}
export function verifyAdReport(code: string, s: string): boolean {
  return !!code && !!s && verifyLink("adreport", code, s);
}

/** Moderation SLA: a paid ad should be reviewed within this many hours. */
export const MODERATION_SLA_HOURS = 12;
export function slaState(waitingSince: Date, now = new Date()): { hours: number; late: boolean } {
  const hours = Math.max(0, Math.round(((now.getTime() - waitingSince.getTime()) / 3600_000) * 10) / 10);
  return { hours, late: hours > MODERATION_SLA_HOURS };
}
