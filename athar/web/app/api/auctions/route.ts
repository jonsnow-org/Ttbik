import { NextResponse } from "next/server";
import { dateInfo, liveAuctionDates } from "@/lib/chain";
export const dynamic = "force-dynamic";
export async function GET() {
  const out = [];
  for (const i of liveAuctionDates()) {
    let d;
    try { d = await dateInfo(i); } catch { continue; }       // busy: show what we have rather than nothing
    if (d.auction?.live || (d.auction && !d.taken)) out.push(d);
  }
  return NextResponse.json({ auctions: out, total: liveAuctionDates().length });
}
