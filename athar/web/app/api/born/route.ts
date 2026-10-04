import { NextResponse } from "next/server";
import { bornOn } from "@/lib/born";
import { TOTAL_DATES, ymd } from "@/lib/dates";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const u = new URL(req.url);
  const i = Number(u.searchParams.get("index"));
  if (!Number.isInteger(i) || i < 0 || i >= TOTAL_DATES) return NextResponse.json({ error: "bad date" }, { status: 400 });
  const { y, m, d } = ymd(i);
  return NextResponse.json(await bornOn(y, m, d, u.searchParams.get("lang") || "en"), { headers: { "Cache-Control": "public, max-age=3600" } });
}
