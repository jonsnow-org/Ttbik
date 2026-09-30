import { NextRequest, NextResponse } from "next/server";
import { Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";

// Anti-cheat retention gate (owner spec, 2026-08-31): a worker who joins a
// Telegram channel just long enough to pass getChatMember and immediately
// leaves shouldn't keep the reward. Runs daily via Vercel Cron (vercel.json)
// and re-checks every TELEGRAM-ad TASK_REWARD from the last 7 days; anyone
// no longer a member gets the reward clawed back and the transaction is
// flipped to REJECTED so it isn't rechecked again.
const RETENTION_DAYS = 7;

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const since = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await prisma.transaction.findMany({
    where: { type: "TASK_REWARD", status: "COMPLETED", created_at: { gte: since }, txHash: { startsWith: "task_" } },
    take: 500,
  });

  let checked = 0;
  let penalized = 0;
  const botCache = new Map<string, TelegramBot>();

  for (const tx of candidates) {
    const adId = tx.txHash?.match(/^task_(.+)_[^_]+$/)?.[1];
    if (!adId) continue;
    const ad = await prisma.ad.findUnique({ where: { id: adId } });
    if (!ad || ad.type !== "TELEGRAM") continue;
    checked++;

    let bot = botCache.get(ad.botId);
    if (!bot) {
      const botRow = await prisma.bot.findUnique({ where: { id: ad.botId } });
      if (!botRow) continue;
      bot = new TelegramBot(botRow.token);
      botCache.set(ad.botId, bot);
    }

    let stillMember = true;
    try {
      const member = await bot.api.getChatMember(ad.content, Number(tx.userId));
      stillMember = ["creator", "administrator", "member"].includes(member.status);
    } catch {
      // Inconclusive (bot no longer admin, channel deleted, rate limit) —
      // never penalize on a check we can't actually confirm.
      continue;
    }
    if (stillMember) continue;

    await prisma.$transaction([
      prisma.user.update({ where: { id: tx.userId }, data: { balance: { decrement: Number(tx.amount) } } }),
      prisma.transaction.update({ where: { id: tx.id }, data: { status: "REJECTED" } }),
      prisma.transaction.create({
        data: { userId: tx.userId, botId: tx.botId, amount: -Number(tx.amount), currency: "internal", type: "PENALTY", status: "COMPLETED" },
      }),
    ]);
    penalized++;

    await bot.api
      .sendMessage(Number(tx.userId), `⚠️ لاحظنا مغادرتك للقناة قبل انتهاء فترة المراجعة (7 أيام)، لذلك تم خصم ${Number(tx.amount).toFixed(2)}$ من رصيدك.`)
      .catch(() => null);
  }

  return NextResponse.json({ ok: true, checked, penalized });
}
