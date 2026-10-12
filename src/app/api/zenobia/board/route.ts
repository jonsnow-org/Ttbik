import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureZenobiaTables } from "@/lib/zenobiaBotLogic";
import { buildBoard, shortAddr } from "@/lib/zenobiaBoard";
import { rawAddress } from "@/lib/zenobiaSeason";

export const dynamic = "force-dynamic";

/** Public. The Caravan Board (longest holders) and, with ?wallet=, that wallet's own place. */
export async function GET(req: NextRequest) {
  try {
    await ensureZenobiaTables();
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT day::text AS day, owner, balance::text AS balance FROM zenobia_snap WHERE day > (SELECT MAX(day) FROM zenobia_snap) - 120 LIMIT 300000`,
    )) as { day: string; owner: string; balance: string }[];
    const b = buildBoard(rows.map((r) => ({ day: r.day, owner: r.owner, balance: BigInt(r.balance.split(".")[0]) })));
    const w = req.nextUrl.searchParams.get("wallet");
    let me: { rank: number; days: number } | null = null;
    if (w) { try { const raw = rawAddress(w); const e = b.entries.find((x) => x.owner === raw); if (e) me = { rank: e.rank, days: e.days }; } catch { /* not an address */ } }
    return NextResponse.json({
      updated: b.latest, holders: b.holders,
      top: b.entries.slice(0, 50).map((e) => ({ rank: e.rank, wallet: shortAddr(e.owner), days: e.days })),
      me,
    }, { headers: { "cache-control": "public, s-maxage=300" } });
  } catch {
    return NextResponse.json({ updated: null, holders: 0, top: [], me: null });
  }
}
