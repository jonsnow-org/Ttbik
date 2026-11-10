import { NextRequest, NextResponse } from "next/server";
import { sweepSponsorUsdt } from "@/lib/khatma/khatma";
import { retryPendingPrizes, settleDueSponsors } from "@/lib/contests/prizes";
import { remitSweep } from "@/lib/remit/listings";
import { findAdmenBot, sweepSiteAdUsdt } from "@/lib/siteAds";
import { codeMessage, sweepBotOrdersUsdt } from "@/lib/botSales";
import { gateUrl } from "@/lib/hostingOps";

// Everything that used to need the owner, done on a schedule (vercel.json crons, run by the site-crons workflow against the gate):
// USDT (TRC20) payments matched on-chain and activated, ended contest slots settled and prizes delivered, remittance listings
// expired and reminded. Each step is idempotent, so overlapping runs are harmless.
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const step = async <T,>(f: () => Promise<T>) => f().catch((e) => ({ error: String(e?.message || e).slice(0, 120) }));
  const sponsorsPaid = await step(sweepSponsorUsdt);
  const siteAdsPaid = await step(sweepSiteAdUsdt);
  const botCodes = await step(async () => {
    const bot = await findAdmenBot();
    return sweepBotOrdersUsdt(async (buyerId, code) => {
      if (bot) await fetch(`https://api.telegram.org/bot${bot.token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: buyerId, text: codeMessage(code, buyerId, gateUrl(), false) }) });
    });
  });
  const contests = await step(settleDueSponsors);
  const prizeRetries = await step(retryPendingPrizes);
  const remit = await step(remitSweep);
  return NextResponse.json({ ok: true, sponsorsPaid, siteAdsPaid, botCodes, contests, prizeRetries, remit });
}
