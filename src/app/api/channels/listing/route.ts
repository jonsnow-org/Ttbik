import { NextRequest, NextResponse } from "next/server";
import { publicListings, requestListing, verifyListing } from "@/lib/channels/exchange";
import { isRateLimited, requestIp } from "@/lib/rateLimit";

// Channel exchange listings. GET: public directory. POST {action:"request"|"verify"}.
export const dynamic = "force-dynamic";
export async function GET() {
  const listings = await publicListings().catch(() => []);
  return NextResponse.json({ ok: true, listings });
}
export async function POST(req: NextRequest) {
  if (isRateLimited(`ch-list:${requestIp(req)}`, 10, 600_000)) return NextResponse.json({ ok: false, error: "طلبات كثيرة. حاول بعد دقائق." }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  const r = b?.action === "verify"
    ? await verifyListing(String(b.token || "")).catch(() => ({ ok: false as const, error: "تعذّر التحقق الآن." }))
    : await requestListing({ channel: String(b.channel || ""), ownerContact: String(b.ownerContact || ""), payoutAddress: String(b.payoutAddress || ""), price: Number(b.price) })
      .catch(() => ({ ok: false as const, error: "تعذّر الحفظ الآن." }));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
