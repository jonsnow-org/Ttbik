import { NextRequest, NextResponse } from "next/server";
import { scanMarriageTonDeposits } from "@/services/marriageTonService";

// MARRIAGE_BOT's own TON deposit scanner — separate cron entry from
// /api/cron/ton-deposits (AD_BOT's), calling the isolated
// marriageTonService.ts so a scan here never touches AD_BOT's tables.
// Same daily-cadence limitation (Vercel Hobby cron caps at once/day).
function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.MASTER_HOT_WALLET_ADDRESS) {
    return NextResponse.json({ ok: true, skipped: "native TON not configured" });
  }
  try {
    const result = await scanMarriageTonDeposits();
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message || "scan failed" }, { status: 500 });
  }
}
