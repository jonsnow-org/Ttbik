import { NextRequest, NextResponse } from "next/server";
import { dealsForChannel, listingByToken, submitPost } from "@/lib/channels/exchange";
import { isRateLimited, requestIp } from "@/lib/rateLimit";

// Channel-owner side, authorised by the private manage token. GET ?token= → listing + deals. POST {token, code, link}.
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const l = await listingByToken(String(req.nextUrl.searchParams.get("token") || "")).catch(() => null);
  if (!l) return NextResponse.json({ ok: false, error: "رابط غير صحيح" }, { status: 404 });
  const deals = l.viaPending || l.status !== "LISTED" ? [] : await dealsForChannel(l.username).catch(() => []);
  const { verify_code, payout_address, viaPending, ...rest } = l;
  void payout_address; void viaPending;
  return NextResponse.json({ ok: true, listing: { ...rest, verifyCode: l.status === "LISTED" ? null : verify_code }, deals });
}
export async function POST(req: NextRequest) {
  if (isRateLimited(`ch-post:${requestIp(req)}`, 20, 600_000)) return NextResponse.json({ ok: false, error: "طلبات كثيرة. حاول بعد دقائق." }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  const r = await submitPost(String(b.token || ""), String(b.code || "").toUpperCase(), String(b.link || "")).catch(() => ({ ok: false as const, error: "تعذّر التحقق الآن." }));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
