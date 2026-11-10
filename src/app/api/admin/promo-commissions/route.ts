import { NextRequest, NextResponse } from "next/server";
import { commissionReport } from "@/lib/promoCommissions";

// Protected by src/middleware.ts (/api/admin/:path*). Read-only aggregates.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const days = Math.min(365, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 30));
  return NextResponse.json(await commissionReport(days));
}
