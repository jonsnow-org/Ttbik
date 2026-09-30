import { NextRequest, NextResponse } from "next/server";
import { createInvoice, isNowPaymentsConfigured } from "@/lib/nowpayments";

// JOBS_BOT's own deposit invoice — a separate route from both
// /api/payments/create-invoice (AD_BOT) and /api/payments/marriage-create-invoice
// (MARRIAGE_BOT), so ipnCallbackUrl always points at jobs-webhook, which
// only ever credits JobsUser/JobsTransaction. Same NOWPayments merchant
// account as the other two bots (one platform-wide API key), but the
// ledgers never share a route or a table.
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
    orderDescription: `Jobs bot wallet deposit`,
    ipnCallbackUrl: `${base}/api/payments/jobs-webhook`,
    successUrl: `${base}/pay/jobs?uid=${uid}&paid=1`,
    cancelUrl: `${base}/pay/jobs?uid=${uid}`,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ invoiceUrl: result.invoiceUrl });
}
