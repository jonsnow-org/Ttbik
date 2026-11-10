import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createInvoice, isNowPaymentsConfigured } from "@/lib/nowpayments";
import { checkSiteAdUsdt, siteAdStarsInvoice, siteAdUsdtQuote } from "@/lib/siteAds";
import { gateUrl } from "@/lib/hostingOps";
import { usdtAddress, usdtNetwork } from "@/lib/usdtWallet";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const code = String(body.code || "").trim().toUpperCase();
  const method = body.method === "usdt" ? "usdt" : body.method === "usdt-check" ? "usdt-check" : body.method === "stars" ? "stars" : "nowpayments";
  const ad = await prisma.siteBannerAd.findUnique({ where: { reservationCode: code } });
  if (!ad) return NextResponse.json({ error: "الكود غير موجود." }, { status: 404 });
  if (method === "usdt-check") {
    // the buyer's page polls this; the cron /api/cron/auto-money also sweeps every open quote
    const r = await checkSiteAdUsdt(code).catch(() => ({ paid: false }));
    return NextResponse.json({ paid: r.paid, code });
  }
  if (ad.paymentStatus === "PAID") return NextResponse.json({ error: "هذا الحجز مدفوع." }, { status: 400 });

  if (method === "stars") {
    // ⭐ opens in Telegram; the Admen bot confirms the payment and the ad goes to review automatically
    const r = await siteAdStarsInvoice(ad);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    return NextResponse.json({ invoiceUrl: r.link, stars: r.stars, code });
  }
  if (method === "usdt") {
    const q = await siteAdUsdtQuote(ad).catch(() => null);
    if (q?.ok) return NextResponse.json({ auto: true, method: "usdt", amount: q.amount, usd: q.usd, usdt: q.address, network: q.network, expiresInMin: q.expiresInMin, code });
    return NextResponse.json({
      manual: true,
      method: "usdt",
      amount: ad.totalPrice,
      usdt: usdtAddress(),
      network: usdtNetwork(),
      note: "حوّل المبلغ ثم أدخل كود الحجز في الخانة السفلية.",
    });
  }
  if (!isNowPaymentsConfigured()) {
    return NextResponse.json({ error: "فاتورة العملات غير مفعّلة. اختر تحويل USDT." }, { status: 400 });
  }
  // the IPN must reach the live engine: never the paused vercel.app address
  const base = (process.env.NEXT_PUBLIC_SITE_URL || gateUrl()).replace(/\/$/, "");
  const result = await createInvoice({
    priceAmount: ad.totalPrice,
    orderId: code,
    orderDescription: `Sham AI banner ${code}`,
    ipnCallbackUrl: `${base}/api/ads/ipn`,
    successUrl: `${base}/advertise?code=${code}&paid=1`,
    cancelUrl: `${base}/advertise?code=${code}`,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ invoiceUrl: result.invoiceUrl, code });
}
