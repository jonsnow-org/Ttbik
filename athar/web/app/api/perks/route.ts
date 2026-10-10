import { NextResponse } from "next/server";
import { tokensOf } from "@/lib/chain";
import { perksFor } from "@/lib/perks";
import { kindOf } from "@/lib/kinds";
export const dynamic = "force-dynamic";
// GET ?address= → what holding this wallet's Athar tokens unlocks (public chain data in, public perks out).
export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address") || "";
  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });
  const tokens = await tokensOf(address);
  const kinds = tokens.map((i) => kindOf(i));
  // "rare" holders: silver or above; "mythic" holders: gold or above (any class counts as above gold)
  const h = { count: tokens.length, rare: kinds.filter((x) => x >= 1).length, mythic: kinds.filter((x) => x >= 2).length };
  return NextResponse.json({ holdings: h, perks: perksFor(h) });
}
