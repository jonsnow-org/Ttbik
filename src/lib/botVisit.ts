import { prisma } from "@/lib/prisma";

/**
 * Records that a real Telegram person genuinely started THIS bot
 * (botId), independent of what any per-template user table's own
 * botId column says. See prisma/migration_31_bot_visit_tracking.sql
 * for why this exists: User/MatchUser/JobsUser upsert on the global
 * Telegram id alone, so a person who already has a row under a
 * DIFFERENT bot deployment never gets counted for this one otherwise.
 *
 * Call this once per real /start, right alongside ensureUser/
 * ensureMatchUser/ensureJobsUser — never in place of them. Failure
 * here must never block a real user's /start, so errors are swallowed
 * (an accurate stat is not worth breaking the bot over).
 */
export async function recordBotVisit(botId: string, tgUserId: string): Promise<void> {
  try {
    await prisma.botVisit.upsert({
      where: { botId_tgUserId: { botId, tgUserId } },
      update: {},
      create: { botId, tgUserId },
    });
  } catch {
    // Never let stats-tracking failures affect a real user's /start.
  }
}
