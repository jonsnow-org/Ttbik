import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureZenobiaTables } from "@/lib/zenobiaBotLogic";
import { ensureSilkTables, silkConfig, silkMetadata, isDead } from "@/lib/zenobiaSilk";
import { parsePassportFile } from "@/lib/zenobiaPassport";
import { holdsCoin } from "@/lib/zenobiaPay";

export const dynamic = "force-dynamic";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");

/** Metadata the wallets read for a Silk Road Passport: GET /api/zenobia/silk/<index>.json */
export async function GET(_req: NextRequest, props: { params: Promise<{ file: string }> }) {
  const { file } = await props.params;
  const index = parsePassportFile(file);
  if (index === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  let mintedAt: Date | null = null, captive = false, legend = false;
  try {
    await ensureZenobiaTables(); await ensureSilkTables();
    const r = (await prisma.$queryRawUnsafe(`SELECT item, minted_at FROM zenobia_silk WHERE idx=$1`, index)) as { item: string | null; minted_at: Date | null }[];
    mintedAt = r[0]?.minted_at ?? null;
    const item = r[0]?.item;
    if (item) {
      const res = await fetch(`https://tonapi.io/v2/nfts/${encodeURIComponent(item)}`, { headers: process.env.TONAPI_KEY ? { authorization: `Bearer ${process.env.TONAPI_KEY}` } : undefined });
      if (res.ok) {
        const nft = (await res.json()) as { owner?: { address?: string } };
        const owner = nft.owner?.address;
        legend = isDead(owner);
        const jetton = await silkConfig("jetton");
        // the owner holds no ZNB (and the coin exists): the passport shows as Captive
        if (!legend && owner && jetton) captive = !(await holdsCoin(owner, jetton, { apiKey: process.env.TONAPI_KEY }));
      }
    }
  } catch { /* fall back to what we know */ }
  return NextResponse.json(silkMetadata({ index, mintedAt, captive, legend }, SITE), { headers: { "cache-control": "public, s-maxage=300" } });
}
