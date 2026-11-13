import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Owner directive, 2026-09-22: after a real bot update ships, the bot
// itself should tell its users -- automatically, not the owner pressing
// the manual "إذاعة" broadcast button each time. This is the automatic
// half: Claude inserts one BotUpdateAnnouncement row per real, curated,
// non-sensitive update (see migration_32_bot_update_announcement.sql);
// this cron (see vercel.json) picks up every row still unsent and
// delivers it, no manual send action required.
export const maxDuration = 60;

// An announcement that has waited longer than this is stale ("we added X" a month later is noise, and after an outage of the scheduler the
// whole backlog would otherwise go out in one burst): it is marked sent with sentCount 0 instead of being broadcast. Exported for the test.
export const ANNOUNCEMENT_MAX_AGE_MS = 72 * 3600 * 1000;
// At most this many announcements are broadcast per run, oldest first, so one run never exceeds its time budget; the rest go on the next run.
export const MAX_BROADCASTS_PER_RUN = 3;

async function sendToNovaUsers(text: string): Promise<number> {
  const bot = await prisma.bot.findFirst({ where: { template: "NOVA_BOT" }, orderBy: { created_at: "asc" } });
  if (!bot) return 0;
  const users = await prisma.novaUser.findMany({ where: { telegramId: { not: null } }, select: { telegramId: true } });
  let sent = 0;
  for (const u of users) {
    if (!u.telegramId) continue;
    try {
      const res = await fetch(`https://api.telegram.org/bot${bot.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: u.telegramId, text }),
      });
      const data = await res.json().catch(() => ({}));
      if (data?.ok) sent++;
    } catch {
      // unreachable/blocked -- skip and keep going
    }
  }
  return sent;
}

// BotVisit, not User/MatchUser/JobsUser.findMany({ where: { botId } }) --
// same accuracy reasoning as every other broadcast on this platform (see
// migration_31_bot_visit_tracking.sql): it's the real "who has actually
// started this bot" list, independent of which bot's row a person's own
// per-template table happens to still point at.
async function sendToBotTemplateUsers(template: string, text: string): Promise<number> {
  const bots = await prisma.bot.findMany({ where: { template, isActive: true }, select: { id: true, token: true } });
  let sent = 0;
  for (const b of bots) {
    const visits = await prisma.botVisit.findMany({ where: { botId: b.id }, select: { tgUserId: true } });
    for (const v of visits) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${b.token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: Number(v.tgUserId), text }),
        });
        const data = await res.json().catch(() => ({}));
        if (data?.ok) sent++;
      } catch {
        // unreachable/blocked -- skip and keep going
      }
    }
  }
  return sent;
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const isAuthorized = !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}`);
  if (!isAuthorized) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const all = await prisma.botUpdateAnnouncement.findMany({ where: { sentAt: null }, orderBy: { createdAt: "asc" } });
  const now = Date.now();
  const stale = all.filter((a) => now - new Date(a.createdAt).getTime() > ANNOUNCEMENT_MAX_AGE_MS);
  const pending = all.filter((a) => !stale.includes(a)).slice(0, MAX_BROADCASTS_PER_RUN);
  for (const ann of stale) await prisma.botUpdateAnnouncement.update({ where: { id: ann.id }, data: { sentAt: new Date(), sentCount: 0 } });
  const results: { id: string; template: string; sent: number }[] = [];

  for (const ann of pending) {
    const sent = ann.template === "NOVA_BOT" ? await sendToNovaUsers(ann.text) : await sendToBotTemplateUsers(ann.template, ann.text);
    await prisma.botUpdateAnnouncement.update({ where: { id: ann.id }, data: { sentAt: new Date(), sentCount: sent } });
    results.push({ id: ann.id, template: ann.template, sent });
  }

  return NextResponse.json({ ok: true, processed: results.length, skippedStale: stale.length, results });
}
