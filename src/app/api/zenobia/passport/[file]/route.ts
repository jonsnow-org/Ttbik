import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureZenobiaTables } from "@/lib/zenobiaBotLogic";
import { parsePassportFile, passportMetadata } from "@/lib/zenobiaPassport";

export const dynamic = "force-dynamic";

const SITE = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");

/** Metadata the wallets read for a Caravan Passport: GET /api/zenobia/passport/<index>.json */
export async function GET(_req: NextRequest, props: { params: Promise<{ file: string }> }) {
  const { file } = await props.params;
  const index = parsePassportFile(file);
  if (index === null) return NextResponse.json({ error: "not found" }, { status: 404 });
  let holder: { joined_at: Date; points: number; rank: number; total: number } | null = null;
  try {
    await ensureZenobiaTables();
    const rows = (await prisma.$queryRawUnsafe(
      `SELECT u.joined_at, u.points,
              (SELECT COUNT(*)+1 FROM zenobia_user x WHERE x.bot_id=u.bot_id AND x.points > u.points)::int AS rank,
              (SELECT COUNT(*) FROM zenobia_user x WHERE x.bot_id=u.bot_id)::int AS total
         FROM zenobia_passport p JOIN zenobia_user u ON u.bot_id=p.bot_id AND u.tg_user_id=p.tg_user_id WHERE p.idx=$1`, index,
    )) as { joined_at: Date; points: number; rank: number; total: number }[];
    holder = rows[0] ?? null;
  } catch {
    holder = null; // the file must still answer: an unknown holder is shown as a Child
  }
  const meta = passportMetadata({ index, joinedAt: holder?.joined_at, points: holder?.points, rank: holder?.rank, total: holder?.total }, SITE);
  return NextResponse.json(meta, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=3600" } });
}
