import { NextRequest, NextResponse } from "next/server";
import { Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { ATHAR_URL, LANGS } from "@/lib/atharBotLogic";
import { ATHAR_SITE } from "@/lib/atharMirror";
import { starsEnabled, sweep } from "@/lib/atharStars";
import { notifyOrder } from "@/lib/atharStarsBot";

// Every few minutes: unpaid orders expire (their date is free again), paid orders that the chain shows as minted are closed and the buyer is told,
// orders that were never minted within 7 days (or paid after expiry) get their Stars back. Does nothing while ATHAR_ENABLE_STARS is off.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  const ok = !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!starsEnabled()) return NextResponse.json({ status: "off" });

  const bots = await prisma.bot.findMany({ where: { template: "ATHAR_BOT" }, select: { id: true, token: true } });
  const apis = new Map(bots.map((b) => [b.id, new TelegramBot(b.token)]));
  try {
    const res = await sweep((id) => apis.get(id)?.api ?? null, ATHAR_SITE);
    for (const n of res.notify) {
      const bot = apis.get(n.order.bot_id);
      if (!bot) continue;
      const u = await prisma.atharBotUser.findUnique({ where: { botId_tgUserId: { botId: n.order.bot_id, tgUserId: n.order.tg_user_id } } }).catch(() => null);
      const lang = (LANGS.some((l) => l.code === u?.lang) ? u!.lang : "en") as "en" | "ar" | "ru" | "tr" | "fa";
      await notifyOrder(bot, n.order, n.what, lang, `${ATHAR_URL}/date/${n.order.date_index}`);
    }
    return NextResponse.json({ status: "ok", expired: res.expired, flagged: res.flagged, minted: res.minted, refunded: res.refunded });
  } catch (e) {
    console.error("[athar-stars cron]", e);
    // the route is secret-gated, so a short reason is safe here and lets the workflow log say what failed
    return NextResponse.json({ status: "error", detail: String((e as Error)?.message || e).replace(/\s+/g, " ").slice(0, 200) }, { status: 500 });
  }
}
