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

/**
 * Accurate per-bot reach for an admin/owner stats screen: distinct real
 * people who started THIS bot (BotVisit), never counting the admin
 * account itself (it gets its own user row only to hold panel state).
 *
 * `ownTableCount` is the count from the template's own user table
 * (already scoped to this bot and admin-free by the caller). Bots whose
 * users predate BotVisit tracking can have fewer BotVisit rows than real
 * users, so the larger of the two is the honest number.
 */
export async function countBotVisitors(
  botId: string,
  excludeTgId?: string,
  ownTableCount = 0,
): Promise<number> {
  try {
    const visits = await prisma.botVisit.count({
      where: excludeTgId ? { botId, tgUserId: { not: excludeTgId } } : { botId },
    });
    return Math.max(visits, ownTableCount);
  } catch {
    return ownTableCount;
  }
}
