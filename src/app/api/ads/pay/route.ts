import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createInvoice, isNowPaymentsConfigured } from "@/lib/nowpayments";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const code = String(body.code || "").trim().toUpperCase();
  const ad = await prisma.siteBannerAd.findUnique({ where: { reservationCode: code } });
  if (!ad) return NextResponse.json({ error: "الكود غير موجود." }, { status: 404 });
  if (ad.paymentStatus === "PAID") return NextResponse.json({ error: "هذا الحجز مدفوع." }, { status: 400 });
  if (!isNowPaymentsConfigured()) {
    return NextResponse.json({
      error: "الدفع الآلي غير مفعّل. أرسل المبلغ إلى محفظة USDT الظاهرة في الصفحة ثم أكّد بالكود.",
      manual: true,
      usdt: process.env.USDT_ADDRESS || "",
      network: process.env.USDT_NETWORK || "TRC20",
    }, { status: 200 });
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
