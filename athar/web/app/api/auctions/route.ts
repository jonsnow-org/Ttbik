import { NextResponse } from "next/server";
import { addresses, auctionIds, auctionOf, dateInfo, isBusy } from "@/lib/chain";
import { dateOf, kindOf } from "@/lib/kinds";
export const dynamic = "force-dynamic";

// The owner's class auctions (bronze ... legendary), listed from the minter's own record of every auction it started.
export async function GET() {
  const a = await addresses(1);
  if (!a) return NextResponse.json({ auctions: [], total: 0 });
  let ids: number[] = [];
  try { ids = await auctionIds(); } catch (e) { if (isBusy(e)) return NextResponse.json({ error: "busy, try again in a moment" }, { status: 503, headers: { "Retry-After": "5" } }); throw e; }
  const out = [];
  for (const id of ids) {
    try {
      const au = await auctionOf(a.minter.address, id);
      if (!au) continue;
      const d = await dateInfo(dateOf(id));
      const taken = d.taken[kindOf(id)];
      const live = au.started && Number(au.endAt) * 1000 > Date.now();
      if (!live && taken) continue;
      out.push({ id, kind: kindOf(id), date: dateOf(id), taken, live, endAt: Number(au.endAt), reserve: Number(au.reserve) / 1e9, highBid: Number(au.highBid) / 1e9, highBidder: au.highBidder?.toString() ?? null, mediaRef: String(au.mediaRef) });
    } catch { continue; }       // busy: show what we have rather than nothing
  }
  return NextResponse.json({ auctions: out, total: ids.length });
}
