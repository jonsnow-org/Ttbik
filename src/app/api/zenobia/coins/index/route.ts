import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { baselines24h, isStale, readSnapshot } from "@/lib/znbtIndex";
import { ensureHiddenTable } from "@/lib/znbtHideDb";

// Public: the indexed coins with their live numbers, plus the hidden list. `stale: true` means the page should fall back to reading the chain itself.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snap = await readSnapshot();
    await ensureHiddenTable();
    const hidden = (await prisma.$queryRawUnsafe(`SELECT curve FROM znbt_hidden LIMIT 1000`)) as { curve: string }[];
    const base = await baselines24h().catch(() => ({} as Awaited<ReturnType<typeof baselines24h>>));
    const coins = (snap?.coins ?? []).map((c) => {
      const b = base[c.curve];
      const now = Number(c.tokensPerTon || 0), old = Number(b?.tpt || 0);
      const chg24 = b && now > 0 && old > 0 ? Math.round((old / now - 1) * 10000) / 100 : null;               // price change, %
      const raised24 = b && c.raisedNano ? (BigInt(c.raisedNano) - BigInt(b.raised)).toString() : null;        // TON raised in the last 24h (nano)
      const mcTon = now > 0 ? Math.round((Number(BigInt(c.supply)) / now) * 100) / 100 : null;                  // market cap in TON at the current price
      return { ...c, chg24, raised24, mcTon };
    });
    return NextResponse.json({ coins, updatedAt: snap?.updatedAt ?? 0, stale: isStale(snap), hidden: hidden.map((h) => h.curve) }, { headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60" } });
  } catch {
    return NextResponse.json({ coins: [], updatedAt: 0, stale: true, hidden: [] });
  }
}
