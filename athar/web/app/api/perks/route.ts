import { NextResponse } from "next/server";
import { tokensOf } from "@/lib/chain";
import { perksFor } from "@/lib/perks";
import { SEASON_1, seasonTier } from "@/lib/seasons";
export const dynamic = "force-dynamic";
// GET ?address= → what holding this wallet's Athar tokens unlocks (public chain data in, public perks out).
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") || "";
  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });
  const tokens = await tokensOf(address);
  const tiers = tokens.map((i) => seasonTier(SEASON_1, i));
  const h = { count: tokens.length, rare: tiers.filter((x) => x === 1).length, mythic: tiers.filter((x) => x === 2).length };
  return NextResponse.json({ holdings: h, perks: perksFor(h) });
}
