import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { isEventPath, isMachineUserAgent } from "@/lib/botUserAgent";

// Public endpoint every visitor's browser calls once per page view (see
// src/components/AnalyticsTracker.tsx). Rate-limited like the site's other
// public write endpoints; deliberately never stores the caller's raw IP or
// full user-agent string, only a derived device_type — see the migration's
// header comment for why.
const hits = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 60; // one visitor navigating many pages is normal, not abuse
const WINDOW_MS = 5 * 60 * 1000;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.resetAt) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > LIMIT;
}

function detectDeviceType(userAgent: string): "mobile" | "desktop" | "tablet" | "unknown" {
  const ua = userAgent.toLowerCase();
  if (!ua) return "unknown";
  if (/ipad|tablet/.test(ua)) return "tablet";
  if (/mobile|iphone|android/.test(ua)) return "mobile";
  return "desktop";
}


export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ ok: false }, { status: 429 });
  }

  const { path, referrer, sessionId } = await req.json().catch(() => ({}));
  if (typeof path !== "string" || !path.trim() || typeof sessionId !== "string" || !sessionId.trim()) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  // a page path, or a conversion event (evt:<name>:<page>) sent by src/lib/trackEvent.ts
  if (!path.startsWith("/") && !isEventPath(path)) return NextResponse.json({ ok: false }, { status: 400 });

  const userAgent = req.headers.get("user-agent") || "";
  if (isMachineUserAgent(userAgent)) {
    // Accept quietly (no error) so a crawler never sees an odd response —
    // it just doesn't get counted as a visitor.
    return NextResponse.json({ ok: true });
  }

  try {
    const db = supabaseAdmin();
    await db.from("page_views").insert({
      path: path.slice(0, 300),
      referrer: typeof referrer === "string" && referrer.trim() ? referrer.slice(0, 500) : null,
      device_type: detectDeviceType(userAgent),
      session_id: sessionId.slice(0, 100),
    });
  } catch {
    // Never let analytics failures surface to a real visitor.
  }

  return NextResponse.json({ ok: true });
}
