/**
 * Shared fixed-window rate limiter in Postgres (works across serverless
 * instances, unlike the in-memory one in inline.ts). One atomic upsert.
 */
import { prisma } from "@/lib/prisma";
import { ensureMatchAppTables } from "@/lib/match/appStore";

export async function pgRateLimit(key: string, max: number, windowSec: number): Promise<boolean> {
  try {
    await ensureMatchAppTables();
    const rows = await prisma.$queryRaw<{ n: number }[]>`
      INSERT INTO match_rate_limits (key, window_start, n) VALUES (${key}, now(), 1)
      ON CONFLICT (key) DO UPDATE SET
        n = CASE WHEN match_rate_limits.window_start < now() - make_interval(secs => ${windowSec}) THEN 1 ELSE match_rate_limits.n + 1 END,
        window_start = CASE WHEN match_rate_limits.window_start < now() - make_interval(secs => ${windowSec}) THEN now() ELSE match_rate_limits.window_start END
      RETURNING n`;
    return Number(rows[0]?.n ?? 1) <= max;
  } catch {
    return true; // never lock users out because the limiter table is unavailable
  }
}
