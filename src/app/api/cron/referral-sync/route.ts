import { NextRequest, NextResponse } from "next/server";
import { syncReferrals } from "@/lib/znbtRefs";

// Hourly (GitHub workflow): credit the invite rewards from the invitees' on-chain buys. Ledger only: nothing is sent from here.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const q = req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || (auth !== `Bearer ${process.env.CRON_SECRET}` && q !== process.env.CRON_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try { return NextResponse.json({ status: "ok", ...(await syncReferrals()) }); }
  catch (e) { console.error("[referral-sync]", e); return NextResponse.json({ status: "error", error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 }); }
}
