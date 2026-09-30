import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Matures the 48h creator-earnings hold (owner spec, 2026-08-31): every
// task completion credits the completing bot's Bot.pendingBalance plus a
// CREATOR_EARNING_PENDING ledger row instead of the withdrawable
// ownerBalance directly (see payoutTask in adBotLogic.ts). This runs
// hourly via Vercel Cron (vercel.json) and moves anything past the 48h
// mark into ownerBalance, flipping the ledger row to RELEASED.
const HOLD_HOURS = 48;

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - HOLD_HOURS * 60 * 60 * 1000);
  const matured = await prisma.transaction.findMany({
    where: { type: "CREATOR_EARNING_PENDING", status: "PENDING", created_at: { lte: cutoff } },
    take: 500,
  });

  let released = 0;
  for (const tx of matured) {
    if (!tx.botId) continue;
    try {
      await prisma.$transaction([
        prisma.bot.update({
          where: { id: tx.botId },
          data: { pendingBalance: { decrement: Number(tx.amount) }, ownerBalance: { increment: Number(tx.amount) } },
        }),
        prisma.transaction.update({ where: { id: tx.id }, data: { status: "RELEASED" } }),
      ]);
      released++;
    } catch {
      // Skip and let the next hourly run retry — never let one bad row
      // abort the whole batch.
      continue;
    }
  }

  return NextResponse.json({ ok: true, checked: matured.length, released });
}
