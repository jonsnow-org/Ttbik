import { NextRequest, NextResponse } from "next/server";
import { scanTonDeposits, checkAndSweepOwnerProfits } from "@/services/ton-service";

// Native TON deposit scanner + owner-profit sweep (owner spec, 2026-09-02).
// Runs daily via Vercel Cron (vercel.json) — Vercel's Hobby plan caps cron
// at once daily, so a TON deposit can take up to ~24h to actually land in
// a user's balance. Real limitation of the free tier; a paid plan (more
// frequent cron) or an external pinger would be needed to shorten it.
// The profit sweep is folded into this same run (rather than a separate
// cron entry) to stay within Vercel's cron-job limits.
function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get("authorization");
  const querySecret = req.nextUrl.searchParams.get("secret");
  return !!process.env.CRON_SECRET && (auth === `Bearer ${process.env.CRON_SECRET}` || querySecret === process.env.CRON_SECRET);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!process.env.MASTER_TON_MNEMONIC || !process.env.MASTER_HOT_WALLET_ADDRESS) {
    return NextResponse.json({ ok: true, skipped: "native TON not configured" });
  }
  try {
    const depositResult = await scanTonDeposits();
    const sweepResult = await checkAndSweepOwnerProfits().catch((error: any) => ({ swept: false, error: error.message }));
    return NextResponse.json({ ok: true, ...depositResult, sweep: sweepResult });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error.message || "scan failed" }, { status: 500 });
  }
}
