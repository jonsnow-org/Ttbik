/**
 * Short cross-instance mutex on the existing match_rate_limits table (no new schema).
 * The first caller inside `ttlSec` gets the lock; a concurrent second caller (double tap, a
 * retried webhook, two instances) gets BUSY instead of running the guarded money step twice.
 * The lock is released as soon as the step ends, so a later legitimate retry is never blocked;
 * the TTL only matters if an instance dies mid-step. Fails OPEN like pgRateLimit: a limiter
 * outage must never block a purchase.
 */
import { prisma } from "@/lib/prisma";
import { pgRateLimit } from "@/lib/match/rateLimitPg";

export const BUSY = Symbol("busy");

export async function withShortLock<T>(key: string, fn: () => Promise<T>, ttlSec = 30): Promise<T | typeof BUSY> {
  if (!(await pgRateLimit(`lock:${key}`, 1, ttlSec))) return BUSY;
  try {
    return await fn();
  } finally {
    try {
      await prisma.$executeRaw`DELETE FROM match_rate_limits WHERE key = ${`lock:${key}`}`;
    } catch {
      /* the TTL frees it */
    }
  }
}
