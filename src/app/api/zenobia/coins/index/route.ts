import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isStale, readSnapshot } from "@/lib/znbtIndex";
import { ensureHiddenTable } from "@/lib/znbtHideDb";

// Public: the indexed coins with their live numbers, plus the hidden list. `stale: true` means the page should fall back to reading the chain itself.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const snap = await readSnapshot();
    await ensureHiddenTable();
    const hidden = (await prisma.$queryRawUnsafe(`SELECT curve FROM znbt_hidden LIMIT 1000`)) as { curve: string }[];
    return NextResponse.json({ coins: snap?.coins ?? [], updatedAt: snap?.updatedAt ?? 0, stale: isStale(snap), hidden: hidden.map((h) => h.curve) }, { headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60" } });
  } catch {
    return NextResponse.json({ coins: [], updatedAt: 0, stale: true, hidden: [] });
  }
}
