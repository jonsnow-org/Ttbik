import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureZenobiaTables } from "@/lib/zenobiaBotLogic";

export const dynamic = "force-dynamic";

/** Public: the newest closed season and its result fingerprint. The ledger wallet on Oracle publishes it on TON. */
export async function GET() {
  try {
    await ensureZenobiaTables();
    const rows = (await prisma.$queryRawUnsafe(`SELECT season, hash FROM zenobia_season ORDER BY season DESC LIMIT 1`)) as { season: string; hash: string }[];
    return NextResponse.json(rows[0] ?? { none: true }, { headers: { "cache-control": "public, s-maxage=60" } });
  } catch {
    return NextResponse.json({ none: true });
  }
}
