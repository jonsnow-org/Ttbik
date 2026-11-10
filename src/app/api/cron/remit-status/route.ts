import { NextRequest, NextResponse } from "next/server";
import { findAdmenBot } from "@/lib/siteAds";
import { pollTransfers } from "@/lib/remit/office";
import { gateUrl } from "@/lib/hostingOps";

// Pushes each remittance's status change (waiting → received → exchanging → sent → done) to the sender's chat.
// Users also get a fresh status whenever they tap «تحديث الحالة» or open the receipt.
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const bot = await findAdmenBot().catch(() => null);
  if (!bot) return NextResponse.json({ ok: true, skipped: "no bot" });
  const r = await pollTransfers({ token: bot.token, site: gateUrl().replace(/\/$/, ""), botUsername: "Admen10bot" }).catch((e) => ({ error: String(e?.message || e).slice(0, 120) }));
  return NextResponse.json({ ok: true, ...r });
}
