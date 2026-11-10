import { NextRequest, NextResponse } from "next/server";
import { Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { ensureMatchAppTables } from "@/lib/match/appStore";
import { digestDay, sendDigest } from "@/lib/match/engage";

// 🔔 Opt-in daily «3 best matches» for MARRIAGE_BOT members (owner-approved 2026-11-11). Only members who switched it
// on (match_digest_optin.enabled), at most one message a day each (match_broadcast_log `digest:<day>`), never the
// same profile twice (`dgp:<member>`). Scheduled like every other cron (vercel.json → Bearer CRON_SECRET).
export const maxDuration = 60;
const MAX_PER_RUN = 300;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const ok = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await ensureMatchAppTables().catch(() => null);
  const day = digestDay();
  const bots = await prisma.bot.findMany({ where: { template: "MARRIAGE_BOT", isActive: true }, select: { id: true, token: true } });
  const tally = { sent: 0, dup: 0, empty: 0, failed: 0 };
  let budget = MAX_PER_RUN;
  for (const b of bots) {
    if (budget <= 0) break;
    const opted = await prisma.$queryRaw<{ user_id: string }[]>`
      SELECT o.user_id FROM match_digest_optin o
      JOIN "MatchUser" u ON u.id = o.user_id
      JOIN "MatchProfile" p ON p."userId" = o.user_id
      WHERE o.enabled AND o.bot_id = ${b.id} AND u."botId" = ${b.id} AND u."isBanned" = false
        AND (u."mutedUntil" IS NULL OR u."mutedUntil" < now()) AND p.status = 'APPROVED'
        AND NOT EXISTS (SELECT 1 FROM match_broadcast_log l WHERE l.campaign = ${`digest:${day}`} AND l.user_id = o.user_id)
      ORDER BY o.updated_at ASC LIMIT ${budget}`.catch(() => [] as { user_id: string }[]);
    if (!opted.length) continue;
    const bot = new TelegramBot(b.token);
    for (const o of opted) {
      budget--;
      const r = await sendDigest(bot, b.id, o.user_id, day).catch(() => "failed" as const);
      tally[r]++;
    }
  }
  return NextResponse.json({ ok: true, day, ...tally });
}
