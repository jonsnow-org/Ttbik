import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureZenobiaTables } from "@/lib/zenobiaBotLogic";
import { ensureSilkTables, silkConfig, silkPriceGram, SILK_CAP } from "@/lib/zenobiaSilk";

export const dynamic = "force-dynamic";

/** Public: how many passports exist, the current price, and whether they are open. */
export async function GET() {
  try {
    await ensureZenobiaTables(); await ensureSilkTables();
    const n = Number(((await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM zenobia_silk WHERE status='minted'`)) as { n: number }[])[0]?.n ?? 0);
    const open = (await silkConfig("silk")) === "on" && !!(await silkConfig("jetton"));
    return NextResponse.json({ open, minted: n, cap: SILK_CAP, priceGram: n >= SILK_CAP ? null : silkPriceGram(n), lockDays: 30 }, { headers: { "cache-control": "public, s-maxage=30" } });
  } catch {
    return NextResponse.json({ open: false });
  }
}
