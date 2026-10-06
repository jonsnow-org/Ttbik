import { NextResponse } from "next/server";
import { seasonStatus, isBusy } from "@/lib/chain";
import { SEASON_1 } from "@/lib/seasons";
export const dynamic = "force-dynamic";
export async function GET() {
  let st;
  try { st = await seasonStatus(1); } catch (e) { if (isBusy(e)) return NextResponse.json({ error: "busy, try again in a moment" }, { status: 503, headers: { "Retry-After": "5" } }); throw e; }
  return NextResponse.json({ ...st, name: SEASON_1.name, walletDailyCap: SEASON_1.walletDailyCap, specials: SEASON_1.specials.length });
}
