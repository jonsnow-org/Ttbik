import { NextRequest, NextResponse } from "next/server";
import { isRateLimited, requestIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Read-only TON JSON-RPC proxy for the Palmyra Launch pages. Added by the owner's order (2026-10-24): the pages used to call toncenter.com from the
// visitor's browser with no key (about 1 request a second, so 429 under load); a key placed in browser code would be public. Now the browser calls this
// same-origin route (through the gate like every /api path) and the server adds TONCENTER_API_KEY. Only the read methods the pages use are allowed;
// nothing here can send a transaction, and the key is never returned. The per-address limit is only a flood guard (behind the gate many visitors can share one address).
const ALLOWED = new Set(["runGetMethod", "getAddressInformation", "getExtendedAddressInformation", "getWalletInformation", "getAddressBalance", "getAddressState", "getTransactions", "getMasterchainInfo", "getConfigParam"]);
const MAX_BODY = 16_000;

export async function POST(req: NextRequest) {
  if (isRateLimited(`ton-rpc:${requestIp(req)}`, 3000, 60_000)) return NextResponse.json({ ok: false, error: "too many requests" }, { status: 429, headers: { "Retry-After": "10" } });
  const text = await req.text();
  if (text.length > MAX_BODY) return NextResponse.json({ ok: false, error: "too large" }, { status: 413 });
  let body: { method?: unknown; params?: unknown; id?: unknown; jsonrpc?: unknown };
  try { body = JSON.parse(text); } catch { return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 }); }
  if (Array.isArray(body) || typeof body.method !== "string" || !ALLOWED.has(body.method)) return NextResponse.json({ ok: false, error: "method not allowed" }, { status: 403 });
  const key = process.env.TONCENTER_API_KEY;
  try {
    const r = await fetch("https://toncenter.com/api/v2/jsonRPC", {
      method: "POST",
      headers: { "content-type": "application/json", ...(key ? { "X-API-Key": key } : {}) },
      body: JSON.stringify({ id: body.id ?? 1, jsonrpc: "2.0", method: body.method, params: body.params ?? {} }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
    const out = await r.text();
    return new NextResponse(out, { status: r.status, headers: { "content-type": r.headers.get("content-type") || "application/json", "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ ok: false, error: "upstream unavailable" }, { status: 502 });
  }
}
