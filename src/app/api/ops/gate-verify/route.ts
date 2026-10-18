import { NextRequest, NextResponse } from "next/server";
import { consumeNonce } from "@/lib/hostingOps";
import { isRateLimited, requestIp } from "@/lib/rateLimit";

// Called by the gate (cloudflare/site-gate) to confirm a one-time nonce created by the owner's bot. The nonce is 128 bits, lives two minutes and works once.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (isRateLimited(`gate-verify:${requestIp(req)}`, 30, 60_000)) return NextResponse.json({ ok: false }, { status: 429 });
  const action = await consumeNonce(String(req.nextUrl.searchParams.get("nonce") || "")).catch(() => null);
  return NextResponse.json(action ? { ok: true, action } : { ok: false }, { headers: { "Cache-Control": "no-store" } });
}
