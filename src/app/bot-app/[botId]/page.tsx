import type { Metadata, Viewport } from "next";
import { appSection, remitPayPayload } from "@/lib/botApp/buttons";
import BotMiniApp from "./BotMiniApp";

// The Mini App of the ads & earn builder's bots (AD_BOT template: the owner bot and supervisor bots). A standalone Telegram app:
// the bot's own ad system (watch & earn, create an ad, my ads, wallet, referrals, stats) plus USDT remittances and the channels &
// groups exchange. Every call goes to /api/bot-app/<botId>, which proves the user with initData signed by THIS bot's token.
// No site header, nav or footer (see the /bot-app branch in src/app/layout.tsx) and no links into the website.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "التطبيق", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false, viewportFit: "cover" };

export default async function BotAppPage({ params, searchParams }: { params: Promise<{ botId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { botId } = await params;
  const sp = await searchParams;
  const pay = typeof sp.pay === "string" ? remitPayPayload(`pay_${sp.pay}`) : null;
  return <BotMiniApp botId={botId} section={appSection(sp.s)} pay={pay} />;
}
