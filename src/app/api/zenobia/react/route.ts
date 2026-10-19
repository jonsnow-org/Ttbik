import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isRateLimited, requestIp } from "@/lib/rateLimit";
import { validCurve } from "@/lib/znbtHide";
import { ensureEngageTables, ipVoter, isReaction, reactionCounts, tgUserFromInit } from "@/lib/znbtEngage";

// Community sentiment on a coin (⭐ 🔥 💔): one vote per kind per Telegram user (or per address outside Telegram). Not a rating of safety.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const curve = validCurve(req.nextUrl.searchParams.get("c") || "");
  if (!curve) return NextResponse.json({ error: "bad request" }, { status: 400 });
  try { return NextResponse.json({ counts: await reactionCounts(curve) }, { headers: { "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60" } }); }
  catch { return NextResponse.json({ counts: { star: 0, fire: 0, broken: 0 } }); }
}

/** Toggle: voting again with the same kind removes the vote. Body { c, kind, initData? }. */
export async function POST(req: NextRequest) {
  const ip = requestIp(req);
  if (isRateLimited(`znbt-react:${ip}`, 40, 60 * 60_000)) return NextResponse.json({ error: "too many votes, try later" }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  const curve = validCurve(String(b.c || ""));
  if (!curve || !isReaction(b.kind)) return NextResponse.json({ error: "bad request" }, { status: 400 });
  await ensureEngageTables();
  const tg = b.initData ? await tgUserFromInit(String(b.initData)) : null;
  const voter = tg ? `tg:${tg}` : ipVoter(ip);
  const had = (await prisma.$queryRawUnsafe(`SELECT 1 FROM znbt_reactions WHERE curve=$1 AND kind=$2 AND voter=$3`, curve, b.kind, voter)) as unknown[];
  if (had.length) await prisma.$executeRawUnsafe(`DELETE FROM znbt_reactions WHERE curve=$1 AND kind=$2 AND voter=$3`, curve, b.kind, voter);
  else await prisma.$executeRawUnsafe(`INSERT INTO znbt_reactions (curve, kind, voter) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, curve, b.kind, voter);
  return NextResponse.json({ ok: true, mine: !had.length, counts: await reactionCounts(curve) });
}
