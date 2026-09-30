import { NextRequest, NextResponse } from "next/server";
import { createInvoice, isNowPaymentsConfigured } from "@/lib/nowpayments";

// MARRIAGE_BOT's own deposit invoice — a separate route from
// /api/payments/create-invoice (AD_BOT's), so ipnCallbackUrl always points
// at marriage-webhook, which only ever credits MatchUser/MatchTransaction.
// Same NOWPayments merchant account as AD_BOT (one platform-wide API key),
// but the two ledgers never share a route or a table (owner directive,
// 2026-09-05 — see MatchTransaction in prisma/schema.prisma).
export async function POST(req: NextRequest) {
  if (!isNowPaymentsConfigured()) {
    return NextResponse.json({ error: "الدفع بعملة رقمية غير مُفعَّل بعد." }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const uid = String(body.uid || "").trim();
  const amount = Math.max(1, Math.min(100000, Number(body.amount) || 0));
  // Telegram ids are digits only: rejects junk that would create stray
  // accounts or break the success/cancel URLs below.
  if (!/^\d{3,20}$/.test(uid) || !amount) return NextResponse.json({ error: "رابط الإيداع غير صالح — افتحه من زر «إيداع» داخل البوت." }, { status: 400 });

  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
  const result = await createInvoice({
    priceAmount: amount,
    orderId: uid,
    orderDescription: `Marriage bot wallet deposit`,
    ipnCallbackUrl: `${base}/api/payments/marriage-webhook`,
    successUrl: `${base}/pay/marriage?uid=${uid}&paid=1`,
    cancelUrl: `${base}/pay/marriage?uid=${uid}`,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ invoiceUrl: result.invoiceUrl });
}
