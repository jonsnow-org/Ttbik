import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { Bot as TelegramBot } from "grammy";

// Auto-release stale escrowed StoreOrders (owner spec, 2026-09-05): if a
// buyer never presses "لقد استلمت المنتج" and never opens a dispute
// within ESCROW_AUTO_RELEASE_DAYS, the held amount releases to the
// seller automatically. Any order with an open (non-RESOLVED) JobsDispute
// is left alone — that one only moves via a manual admin decision (see
// resolveDispute in jobsBotLogic.ts).
const ESCROW_AUTO_RELEASE_DAYS = 7;

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - ESCROW_AUTO_RELEASE_DAYS * 24 * 60 * 60 * 1000);
  const candidates = await prisma.storeOrder.findMany({
    where: { status: "ESCROWED", escrowedAt: { lt: cutoff } },
    take: 200,
  });

  let released = 0;
  const botCache = new Map<string, TelegramBot>();

  for (const order of candidates) {
    const openDispute = await prisma.jobsDispute.findUnique({ where: { orderId: order.id } });
    if (openDispute && openDispute.status !== "RESOLVED") continue; // left for manual admin resolution

    await prisma.$transaction([
      prisma.jobsUser.update({ where: { id: order.sellerId }, data: { balance: { increment: order.amount } } }),
      prisma.jobsTransaction.create({ data: { userId: order.sellerId, amount: order.amount, currency: "internal", type: "ESCROW_RELEASE", status: "COMPLETED" } }),
      prisma.storeOrder.update({ where: { id: order.id }, data: { status: "RELEASED", releasedAt: new Date() } }),
    ]);
    released++;

    const botRow = await prisma.bot.findFirst({ where: { template: "JOBS_BOT" } });
    if (botRow) {
      let bot = botCache.get(botRow.id);
      if (!bot) {
        bot = new TelegramBot(botRow.token);
        botCache.set(botRow.id, bot);
      }
      await bot.api
        .sendMessage(Number(order.sellerId), `✅ تم تحرير مبلغ $${order.amount.toFixed(2)} لرصيدك تلقائياً بعد مرور ${ESCROW_AUTO_RELEASE_DAYS} أيام دون بلاغ أو نزاع.`)
        .catch(() => null);
      await bot.api
        .sendMessage(Number(order.buyerId), `ℹ️ تم تحرير مبلغ طلبك تلقائياً للبائع بعد مرور ${ESCROW_AUTO_RELEASE_DAYS} أيام دون تأكيد استلام أو فتح نزاع.`)
        .catch(() => null);
    }
  }

  return NextResponse.json({ ok: true, checked: candidates.length, released });
}
