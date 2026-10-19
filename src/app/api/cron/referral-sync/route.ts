import { NextRequest, NextResponse } from "next/server";
import { syncReferrals } from "@/lib/znbtRefs";
import { runPayouts } from "@/lib/znbtPayout";

// Hourly (GitHub workflow): credit the invite rewards from the invitees' on-chain buys, then pay what is due ONLY if the owner switched automatic payouts on (/referrals on).
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const q = req.nextUrl.searchParams.get("secret");
  if (!process.env.CRON_SECRET || (auth !== `Bearer ${process.env.CRON_SECRET}` && q !== process.env.CRON_SECRET)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const synced = await syncReferrals();
    const paid = await runPayouts(false).catch((e) => ({ sent: 0, total: 0n, note: String(e?.message || e).slice(0, 120) }));
    return NextResponse.json({ status: "ok", ...synced, paid: paid.sent, payoutNote: paid.note });
  }
  catch (e) { console.error("[referral-sync]", e); return NextResponse.json({ status: "error", error: String((e as Error)?.message ?? e).slice(0, 200) }, { status: 500 }); }
}
