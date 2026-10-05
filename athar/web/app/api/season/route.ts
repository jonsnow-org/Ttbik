import { NextResponse } from "next/server";
import { seasonStatus } from "@/lib/chain";
import { SEASON_1, buildPool, seasonSize } from "@/lib/seasons";
import { ymd } from "@/lib/dates";
export const dynamic = "force-dynamic";
export async function GET() {
  const st = await seasonStatus(1);
  const pool = buildPool(SEASON_1);
  return NextResponse.json({ ...st, name: SEASON_1.name, size: seasonSize(SEASON_1), pool: pool.composition, walletDailyCap: SEASON_1.walletDailyCap, fromYear: ymd(SEASON_1.rangeStart).y, toYear: ymd(SEASON_1.rangeEnd).y, specials: SEASON_1.specials.length });
}
