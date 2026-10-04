import { NextResponse } from "next/server";
import { SEASON_1, buildPool } from "@/lib/seasons";
// The mystery pool is public: anyone can check the odds and recompute the list.
export async function GET() {
  const p = buildPool(SEASON_1);
  return NextResponse.json({ season: 1, composition: p.composition, dates: p.dates });
}
