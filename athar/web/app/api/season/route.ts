import { NextResponse } from "next/server";
import { seasonStatus } from "@/lib/chain";
import { SEASON_1, buildPool, seasonSize } from "@/lib/seasons";
export const dynamic = "force-dynamic";
export async function GET() {
  const st = await seasonStatus(1);
  const pool = buildPool(SEASON_1);
  return NextResponse.json({ ...st, name: SEASON_1.name, size: seasonSize(SEASON_1), pool: pool.composition, walletDailyCap: SEASON_1.walletDailyCap });
}
