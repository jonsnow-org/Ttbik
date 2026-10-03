import { NextRequest, NextResponse } from "next/server";
import { mediaDb } from "@/lib/mediaSocial";
import { hookSecret, safeEqual } from "@/lib/mediaFrontDoor";

// Health summary pushed by the Oracle VM agent (deploy/oracle/agent/common.sh -> report).
//   POST  (x-ops-key = the same token-derived secret the media bot uses)  stores the summary
//   GET   (public)  returns it: commit, container states, memory/disk, backup age, last deploy tail.
// The sender masks tokens; nothing secret is stored or served here.
export const dynamic = "force-dynamic";
const KEY = "oracle_status";

export async function POST(req: NextRequest) {
  const s = hookSecret();
  if (!s || !safeEqual(req.headers.get("x-ops-key") || "", s)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = await req.text();
  if (raw.length > 20_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  let body: any;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const db = await mediaDb();
  if (!db) return NextResponse.json({ error: "no db" }, { status: 500 });
  const { error } = await db.from("bot_settings").upsert({ key: KEY, value: { ...body, received_at: new Date().toISOString() }, updated_at: new Date().toISOString() });
  return error ? NextResponse.json({ error: "store failed" }, { status: 500 }) : NextResponse.json({ ok: true });
}

export async function GET() {
  const db = await mediaDb();
  if (!db) return NextResponse.json({ error: "no db" }, { status: 500 });
  const { data } = await db.from("bot_settings").select("value").eq("key", KEY).maybeSingle();
  const v: any = (data as any)?.value;
  if (!v) return NextResponse.json({ status: "no report yet" });
  const ageMin = v.received_at ? Math.round((Date.now() - Date.parse(v.received_at)) / 60000) : null;
  return NextResponse.json({ ...v, report_age_min: ageMin, stale: ageMin !== null && ageMin > 10 }, { headers: { "cache-control": "no-store" } });
}
