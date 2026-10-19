import { NextRequest, NextResponse } from "next/server";
import { isRateLimited, requestIp } from "@/lib/rateLimit";
import { tgUserFromInit } from "@/lib/znbtEngage";
import { linkWallet } from "@/lib/znbtRefs";

export const dynamic = "force-dynamic";

/** Binds the wallet the user proved ownership of (TonConnect ton_proof) to their Telegram account: the address invite rewards are credited to and read from. */
export async function POST(req: NextRequest) {
  if (isRateLimited(`znbt-link:${requestIp(req)}`, 20, 60 * 60_000)) return NextResponse.json({ error: "too many requests" }, { status: 429 });
  const tg = await tgUserFromInit(req.headers.get("x-tg-init") || "");
  if (!tg) return NextResponse.json({ error: "open in Telegram" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const r = await linkWallet(tg, { account: b.account, proof: b.proof });
  return r.ok ? NextResponse.json({ ok: true, address: r.address }) : NextResponse.json({ error: r.error }, { status: 400 });
}
