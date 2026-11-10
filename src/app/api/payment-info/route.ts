import { NextRequest, NextResponse } from "next/server";
import { usdtAddress, usdtNetwork } from "@/lib/usdtWallet";

// Payment details live in server-only env vars (no NEXT_PUBLIC_ prefix) so
// they are never baked into the public JS bundle — they're only sent to a
// browser that actively requests this endpoint, not to every visitor by
// default. A light per-IP rate limit discourages naive bulk scraping.
const hits = new Map<string, { count: number; resetAt: number }>();
const LIMIT = 20;
const WINDOW_MS = 10 * 60 * 1000;

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

export async function GET(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "طلبات كثيرة، حاول لاحقاً" }, { status: 429 });
  }

  return NextResponse.json({
    bank: {
      holder: process.env.BANK_HOLDER || "",
      account: process.env.BANK_ACCOUNT_NUMBER || "",
      routing: process.env.BANK_ROUTING_NUMBER || "",
      type: process.env.BANK_ACCOUNT_TYPE || "",
      name: process.env.BANK_NAME || "",
      address: process.env.BANK_ADDRESS || "",
    },
    usdt: {
      address: usdtAddress(),
      network: usdtNetwork(),
    },
  });
}
