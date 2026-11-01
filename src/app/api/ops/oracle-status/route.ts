import { NextRequest, NextResponse } from "next/server";
import { mediaDb } from "@/lib/mediaSocial";
import { hookSecret, safeEqual } from "@/lib/mediaFrontDoor";

export const dynamic = "force-dynamic";
const KEY = "oracle_status";

export async function POST(req: NextRequest) {
  const secret = hookSecret();
  if (!secret || !safeEqual(req.headers.get("x-ops-key") || "", secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const raw = await req.text();
  if (raw.length > 20_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  let body: any;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "invalid report" }, { status: 400 });
  const db = await mediaDb();
  if (!db) return NextResponse.json({ error: "no db" }, { status: 500 });
  const { error } = await db.from("bot_settings").upsert({
    key: KEY,
    value: { ...body, received_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  });
  return error ? NextResponse.json({ error: "store failed" }, { status: 500 }) : NextResponse.json({ ok: true });
}

/**
 * Public, deliberately minimal liveness contract used by sync-main.yml.
 * Do not expose deployment logs, container names, resource telemetry,
 * backup metadata, bot identities, or operational internals anonymously.
 */
export async function GET() {
  const db = await mediaDb();
  if (!db) return NextResponse.json({ error: "no db" }, { status: 500 });
  const { data } = await db.from("bot_settings").select("value").eq("key", KEY).maybeSingle();
  const report: any = data?.value;
  if (!report) return NextResponse.json({ status: "no report yet" }, { headers: { "cache-control": "no-store" } });

  const receivedAt = typeof report.received_at === "string" ? report.received_at : null;
  const parsedAt = receivedAt ? Date.parse(receivedAt) : NaN;
  const ageMin = Number.isFinite(parsedAt) ? Math.max(0, Math.round((Date.now() - parsedAt) / 60000)) : null;
  const rawSiteStatus = String(report.site?.status || "");
  // Keep only the timestamp + generic success/failure + short commit marker.
  const siteStatus = rawSiteStatus.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\s+(OK|FAILED)(?:\s+([a-f0-9]{7,40}))?/i);
  const safeSiteStatus = siteStatus ? [siteStatus[1], siteStatus[2].toUpperCase(), siteStatus[3] || ""].filter(Boolean).join(" ") : "unknown";
  const commit = /^[a-f0-9]{7,40}$/i.test(String(report.commit || "")) ? String(report.commit).slice(0, 40) : null;

  return NextResponse.json({
    commit,
    site: { status: safeSiteStatus },
    received_at: receivedAt,
    report_age_min: ageMin,
    stale: ageMin === null || ageMin > 10,
  }, { headers: { "cache-control": "no-store" } });
}
