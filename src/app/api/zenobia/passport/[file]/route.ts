import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureZenobiaTables } from "@/lib/zenobiaBotLogic";
import { ownerGone, parsePassportFile, passportMetadata, soldEverything } from "@/lib/zenobiaPassport";
import { rawAddress } from "@/lib/zenobiaSeason";

export const dynamic = "force-dynamic";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");

/** Metadata the wallets read for a Caravan Passport: GET /api/zenobia/passport/<index>.json */
export async function GET(_req: NextRequest, props: { params: Promise<{ file: string }> }) {
  const { file } = await props.params;
  const index = parsePassportFile(file);
  if (index === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  type Holder = { joined_at: Date; points: number; rank: number; total: number; item: string | null; wallet: string | null; wallet_verified: boolean; jetton: string | null };
  let holder = null as Holder | null;
  let burned = false, sold = false;
  try {
    await ensureZenobiaTables();
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT u.joined_at, u.points, p.item, u.wallet, u.wallet_verified,
              (SELECT v FROM zenobia_config c WHERE c.bot_id=u.bot_id AND c.k='jetton') AS jetton,
              (SELECT COUNT(*)+1 FROM zenobia_user x WHERE x.bot_id=u.bot_id AND x.points > u.points)::int AS rank,
              (SELECT COUNT(*) FROM zenobia_user x WHERE x.bot_id=u.bot_id)::int AS total
         FROM zenobia_passport p JOIN zenobia_user u ON u.bot_id=p.bot_id AND u.tg_user_id=p.tg_user_id WHERE p.idx=$1`, index,
    )) as Holder[];
    holder = rows[0] ?? null;
    if (holder?.item) {
      // the holder can destroy the passport: then tonapi shows no owner (the Legend stage)
      const r = await fetch(`https://tonapi.io/v2/nfts/${holder.item}`, { signal: AbortSignal.timeout(4000) }).catch(() => null);
      if (r?.ok) burned = ownerGone(await r.json().catch(() => null));
    }
    if (holder?.wallet && holder.wallet_verified && holder.jetton) {
      const w = rawAddress(holder.wallet);
      const q = (await prisma.$queryRawUnsafe(
        `SELECT (SELECT MAX(day)::text FROM zenobia_snap) AS latest,
                EXISTS(SELECT 1 FROM zenobia_snap WHERE owner=$1 AND balance>0) AS ever,
                EXISTS(SELECT 1 FROM zenobia_snap WHERE owner=$1 AND day=(SELECT MAX(day) FROM zenobia_snap)) AS inlatest`, w,
      )) as { latest: string | null; ever: boolean; inlatest: boolean }[];
      sold = soldEverything({ jettonSet: true, everHeld: !!q[0]?.ever, inLatest: !!q[0]?.inlatest, latestDay: q[0]?.latest ?? null, today: new Date().toISOString().slice(0, 10) });
    }
  } catch {
    holder = null; // the file must still answer: an unknown holder is shown as a Child
  }
  const meta = passportMetadata({ index, joinedAt: holder?.joined_at, points: holder?.points, rank: holder?.rank, total: holder?.total, burned, soldAll: sold }, SITE);
  return NextResponse.json(meta, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=3600" } });
}
