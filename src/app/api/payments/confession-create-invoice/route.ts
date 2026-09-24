import { NextRequest, NextResponse } from "next/server";
import { createInvoice, isNowPaymentsConfigured } from "@/lib/nowpayments";

// CONFESSION_BOT's own deposit invoice — a separate route from every other
// bot's *-create-invoice route, so ipnCallbackUrl always points at
// confession-webhook, which only ever credits ConfessionUser/
// ConfessionTransaction. Same NOWPayments merchant account as the other
// bots (one platform-wide API key), but the ledgers never share a route or
// a table.
export async function POST(req: NextRequest) {
  if (!isNowPaymentsConfigured()) {
    return NextResponse.json({ error: "الدفع بعملة رقمية غير مُفعَّل بعد." }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const uid = String(body.uid || "").trim();
  const amount = Math.max(1, Math.min(100000, Number(body.amount) || 0));
  if (!uid || !amount) return NextResponse.json({ error: "أكمل المبلغ ومعرف المستخدم" }, { status: 400 });

  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik.vercel.app").replace(/\/$/, "");
  const result = await createInvoice({
    priceAmount: amount,
    orderId: uid,
    orderDescription: `Confession bot wallet deposit`,
    ipnCallbackUrl: `${base}/api/payments/confession-webhook`,
    successUrl: `${base}/pay/confession?uid=${uid}&paid=1`,
    cancelUrl: `${base}/pay/confession?uid=${uid}`,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ invoiceUrl: result.invoiceUrl });
}
