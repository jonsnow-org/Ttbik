import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createInvoice, isNowPaymentsConfigured } from "@/lib/nowpayments";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const code = String(body.code || "").trim().toUpperCase();
  const method = body.method === "usdt" ? "usdt" : "nowpayments";
  const ad = await prisma.siteBannerAd.findUnique({ where: { reservationCode: code } });
  if (!ad) return NextResponse.json({ error: "الكود غير موجود." }, { status: 404 });
  if (ad.paymentStatus === "PAID") return NextResponse.json({ error: "هذا الحجز مدفوع." }, { status: 400 });

  if (method === "usdt") {
    return NextResponse.json({
      manual: true,
      method: "usdt",
      amount: ad.totalPrice,
      usdt: process.env.USDT_ADDRESS || "",
      network: process.env.USDT_NETWORK || "TRC20",
      note: "حوّل المبلغ ثم أدخل كود الحجز في الخانة السفلية.",
    });
  }
  if (!isNowPaymentsConfigured()) {
    return NextResponse.json({ error: "فاتورة العملات غير مفعّلة. اختر تحويل USDT." }, { status: 400 });
  }
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
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
