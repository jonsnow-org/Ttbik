import { NextRequest, NextResponse } from "next/server";
import { scanJobsTonDeposits } from "@/services/jobsTonService";

// JOBS_BOT's own TON deposit scanner — separate cron entry from
// /api/cron/ton-deposits (AD_BOT) and /api/cron/marriage-ton-deposits
// (MARRIAGE_BOT), calling the isolated jobsTonService.ts so a scan here
// never touches another bot's tables.
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
    const result = await scanJobsTonDeposits();
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message || "scan failed" }, { status: 500 });
  }
}
