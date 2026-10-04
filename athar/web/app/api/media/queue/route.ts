import { NextResponse } from "next/server";
import { attempt, enqueue, validateSvg } from "@/lib/mediaQueue";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The buyer's browser could not store its picture itself: keep it here, try now, and keep trying. Nothing is trusted: the file is
// checked, and its id comes from its own content, so the only thing anyone can ever make this endpoint do is store that file.
const hits = new Map<string, number[]>();
const limited = (ip: string) => { const now = Date.now(), l = (hits.get(ip) || []).filter((t) => now - t < 3600_000); l.push(now); hits.set(ip, l); return l.length > 40; };

export async function POST(req: Request) {
  const ip = (req.headers.get("x-forwarded-for") || "x").split(",")[0].trim();
  if (limited(ip)) return NextResponse.json({ error: "too many requests" }, { status: 429 });
  const b = await req.json().catch(() => null);
  const bad = validateSvg(b?.svg);
  if (bad) return NextResponse.json({ error: bad }, { status: 400 });
  const item = await enqueue(b.svg);
  const readable = await attempt(item.id).catch(() => false);          // first try right away (the server's own network)
  return NextResponse.json({ id: item.id, ref: item.ref.toString(), queued: true, readable });
}
