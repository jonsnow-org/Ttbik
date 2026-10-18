import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Health check of this server for the gate (cloudflare/site-gate), the Oracle watchdog and a human with a browser.
// Plain: no database (the gate calls it often). ?deep=1 also pings the database.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const out: { ok: boolean; host: string | null; time: number; db?: boolean } = { ok: true, host: process.env.VERCEL ? "vercel" : "self-hosted", time: Math.floor(Date.now() / 1000) };
  if (req.nextUrl.searchParams.get("deep") === "1") {
    try { await prisma.$queryRawUnsafe("SELECT 1"); out.db = true; } catch { out.db = false; out.ok = false; }
  }
  return NextResponse.json(out, { status: out.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
