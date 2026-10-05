import { NextResponse } from "next/server";
import { seasonStatus, isBusy } from "@/lib/chain";
import { SEASON_1, buildPool, seasonSize } from "@/lib/seasons";
import { ymd } from "@/lib/dates";
export const dynamic = "force-dynamic";
export async function GET() {
  let st;
  try { st = await seasonStatus(1); } catch (e) { if (isBusy(e)) return NextResponse.json({ error: "busy, try again in a moment" }, { status: 503, headers: { "Retry-After": "5" } }); throw e; }
  const pool = buildPool(SEASON_1);
  return NextResponse.json({ ...st, name: SEASON_1.name, size: seasonSize(SEASON_1), pool: pool.composition, walletDailyCap: SEASON_1.walletDailyCap, fromYear: ymd(SEASON_1.rangeStart).y, toYear: ymd(SEASON_1.rangeEnd).y, specials: SEASON_1.specials.length });
}
