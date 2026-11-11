import { NextRequest, NextResponse } from "next/server";
import { createAdDeal, dealByCode, payDeal } from "@/lib/channels/exchange";
import { isRateLimited, requestIp } from "@/lib/rateLimit";

// Advertiser side. POST {action:"create", channel, adText, targetUrl, contact} | {action:"pay", code, method}. GET ?code= status.
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const d = await dealByCode(String(req.nextUrl.searchParams.get("code") || "").toUpperCase()).catch(() => null);
  if (!d || d.kind === "ASSET_SALE") return NextResponse.json({ ok: false, error: "غير موجود" }, { status: 404 });
  return NextResponse.json({ ok: true, deal: { code: d.code, kind: d.kind, channel: d.channel, price: d.price, status: d.status, postLink: d.post_link, paymentReference: d.payment_reference || null, settlementReference: d.settlement_reference || null } });
}
export async function POST(req: NextRequest) {
  if (isRateLimited(`ch-deal:${requestIp(req)}`, 15, 600_000)) return NextResponse.json({ ok: false, error: "طلبات كثيرة. حاول بعد دقائق." }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  let r: { ok: boolean; error?: string };
  if (b?.action === "pay") {
    const m = ["stars", "nowpayments", "usdt"].includes(b.method) ? b.method : "usdt";
    r = await payDeal(String(b.code || "").toUpperCase(), m).catch(() => ({ ok: false, error: "تعذّر إنشاء الدفع." }));
  } else {
    r = await createAdDeal({ channel: String(b.channel || ""), adText: String(b.adText || ""), targetUrl: String(b.targetUrl || ""), contact: String(b.contact || "") })
      .catch(() => ({ ok: false, error: "تعذّر إنشاء الطلب." }));
  }
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
