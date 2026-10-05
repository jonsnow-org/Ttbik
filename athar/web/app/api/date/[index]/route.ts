import { NextResponse } from "next/server";
import { dateInfo, isBusy } from "@/lib/chain";
import { TOTAL_DATES } from "@/lib/dates";
export const dynamic = "force-dynamic";
export async function GET(_: Request, { params }: { params: Promise<{ index: string }> }) {
  const i = Number((await params).index);
  if (!Number.isInteger(i) || i < 0 || i >= TOTAL_DATES) return NextResponse.json({ error: "bad date" }, { status: 400 });
  try { return NextResponse.json(await dateInfo(i)); } catch (e) { if (isBusy(e)) return NextResponse.json({ error: "busy, try again in a moment" }, { status: 503, headers: { "Retry-After": "5" } }); throw e; }
}
