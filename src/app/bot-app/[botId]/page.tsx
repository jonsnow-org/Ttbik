import type { Metadata, Viewport } from "next";
import { prisma } from "@/lib/prisma";
import { appSection, remitPayPayload } from "@/lib/botApp/buttons";
import BotMiniApp from "./BotMiniApp";
import StreakMiniApp from "./StreakMiniApp";

// Each bot's own Mini App, chosen by the bot's template. A standalone Telegram app with no site header, nav or footer (see the
// /bot-app branch in src/app/layout.tsx) and no links into the website. Every call goes to /api/bot-app/<botId>, which proves
// the user with initData signed by THIS bot's token.
//  - AD_BOT (ads & earn owner/supervisor bots): ad system + wallet + referrals, USDT remittances, channels & groups exchange.
//  - STREAK_BOT (daily chains, @Slaselbot): daily chains, group khatma, group contests.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "التطبيق", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover" };

export default async function BotAppPage({ params, searchParams }: { params: Promise<{ botId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { botId } = await params;
  const sp = await searchParams;
  const s = appSection(sp.s);
  const row = await prisma.bot.findUnique({ where: { id: botId }, select: { template: true } }).catch(() => null);
  if (row?.template === "STREAK_BOT") {
    const k = typeof sp.k === "string" && /^[a-z2-9]{8}$|^\d{1,12}$/.test(sp.k) ? sp.k : null;
    return <StreakMiniApp botId={botId} section={s === "khatma" || s === "contests" ? s : "home"} khatma={k} />;
  }
  const pay = typeof sp.pay === "string" ? remitPayPayload(`pay_${sp.pay}`) : null;
  return <BotMiniApp botId={botId} section={s === "khatma" || s === "contests" ? "home" : s} pay={pay} />;
}
