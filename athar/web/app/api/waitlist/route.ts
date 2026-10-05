import { NextResponse } from "next/server";
import { TOTAL_DATES } from "@/lib/dates";
import { countOf, vote, voter } from "@/lib/waitlist";
export const dynamic = "force-dynamic";

const idx = (v: unknown) => { const i = Number(v); return Number.isInteger(i) && i >= 0 && i < TOTAL_DATES ? i : -1; };
export async function GET(req: Request) {
  const i = idx(new URL(req.url).searchParams.get("index"));
  if (i < 0) return NextResponse.json({ error: "bad date" }, { status: 400 });
  return NextResponse.json({ n: countOf(i) });
}
export async function POST(req: Request) {
  const b = await req.json().catch(() => null);
  const i = idx(b?.index);
  if (i < 0) return NextResponse.json({ error: "bad date" }, { status: 400 });
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
  return NextResponse.json(vote(i, voter(ip, req.headers.get("user-agent") || ""), typeof b?.contact === "string" ? b.contact.slice(0, 40) : undefined));
}
