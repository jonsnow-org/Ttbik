import { NextResponse } from "next/server";
import { allTokens } from "@/lib/chain";
import { SEASON_1, specialIndex } from "@/lib/seasons";
import { dateOf, kindOf } from "@/lib/kinds";
import { pickDates, estimate, type PickMode } from "@/lib/bulk";
export const dynamic = "force-dynamic";

// Management only. Proposes the dates for the owner's own stock of one direct kind (normal, silver or gold): free, not special, not already taken in that kind.
const deny = (req: Request) => { const s = process.env.ATHAR_ADMIN_PATH || ""; return !s || req.headers.get("x-athar-adm") !== s; };

export async function GET(req: Request) {
  if (deny(req)) return new Response("Not Found", { status: 404 });
  const u = new URL(req.url);
  const count = Math.max(1, Math.min(1000, Number(u.searchParams.get("count")) || 10));
  const kindParam = Number(u.searchParams.get("kind"));
  const kind = kindParam === 1 || kindParam === 2 ? kindParam : 0;
  const mode: PickMode = u.searchParams.get("mode") === "start" ? "start" : "spread";
  const special = new Set(SEASON_1.specials.map(specialIndex));
  const taken = new Set((await allTokens()).filter((t) => kindOf(t.index) === kind).map((t) => dateOf(t.index)));
  const candidates: number[] = [];
  for (let i = SEASON_1.rangeStart; i <= SEASON_1.rangeEnd; i++) if (!taken.has(i) && !special.has(i)) candidates.push(i);
  const dates = pickDates(candidates, count, mode);
  return NextResponse.json({ kind, dates, available: candidates.length, ...estimate(dates.length) });
}
