import { NextRequest, NextResponse } from "next/server";
import { ticksOf } from "@/lib/znbtIndex";

export const dynamic = "force-dynamic";

/** Public: the price history of one coin for its chart. ?c=<curve address>&days=7 */
export async function GET(req: NextRequest) {
  const c = req.nextUrl.searchParams.get("c") || "";
  if (!/^[A-Za-z0-9_-]{48}$/.test(c)) return NextResponse.json({ ticks: [] }, { status: 400 });
  const days = Math.min(30, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || 7));
  try { return NextResponse.json({ ticks: await ticksOf(c, days) }, { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" } }); }
  catch { return NextResponse.json({ ticks: [] }); }
}
