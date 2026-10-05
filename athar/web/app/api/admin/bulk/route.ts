import { NextResponse } from "next/server";
import { allTokens } from "@/lib/chain";
import { buildPool, SEASON_1, seasonTier, specialIndex } from "@/lib/seasons";
import { pickDates, estimate, type PickMode } from "@/lib/bulk";
export const dynamic = "force-dynamic";

// Management only. Proposes the dates for the owner's own stock: free, direct-sale (common or rare, not special, not in the mystery boxes).
const deny = (req: Request) => { const s = process.env.ATHAR_ADMIN_PATH || ""; return !s || req.headers.get("x-athar-adm") !== s; };

export async function GET(req: Request) {
  if (deny(req)) return new Response("Not Found", { status: 404 });
  const u = new URL(req.url);
  const count = Math.max(1, Math.min(1000, Number(u.searchParams.get("count")) || 10));
  const tier = Number(u.searchParams.get("tier")) === 1 ? 1 : 0;
  const mode: PickMode = u.searchParams.get("mode") === "start" ? "start" : "spread";
  const special = new Set(SEASON_1.specials.map(specialIndex));
  const pool = new Set(buildPool(SEASON_1).dates);
  const taken = new Set((await allTokens()).map((t) => t.index));
  const candidates: number[] = [];
  for (let i = SEASON_1.rangeStart; i <= SEASON_1.rangeEnd; i++) if (!taken.has(i) && !special.has(i) && !pool.has(i) && seasonTier(SEASON_1, i) === tier) candidates.push(i);
  const dates = pickDates(candidates, count, mode);
  return NextResponse.json({ dates, available: candidates.length, ...estimate(dates.length) });
}
