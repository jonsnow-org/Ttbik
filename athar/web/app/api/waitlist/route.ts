import { NextResponse } from "next/server";
import { TOTAL_DATES } from "@/lib/dates";
import { countOf, vote, voter } from "@/lib/waitlist";
export const dynamic = "force-dynamic";

// at most 20 requests per person per hour (the vote itself is also one per person per date)
const hits = new Map<string, number[]>();
const limited = (who: string) => {
  const now = Date.now(), arr = (hits.get(who) || []).filter((t) => now - t < 3_600_000);
  arr.push(now); hits.set(who, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < 3_600_000)) hits.delete(k);
  return arr.length > 20;
};

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
  if (limited(ip)) return NextResponse.json({ error: "too many requests" }, { status: 429 });
  return NextResponse.json(vote(i, voter(ip, req.headers.get("user-agent") || ""), typeof b?.contact === "string" ? b.contact.slice(0, 40) : undefined));
}
