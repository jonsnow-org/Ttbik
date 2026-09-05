import { NextRequest, NextResponse } from "next/server";
import { createInvoice, isNowPaymentsConfigured } from "@/lib/nowpayments";
import { SITE_URL } from "@/lib/siteUrl";

// NOVA_BOT's own subscription invoice — a separate route from every other
// bot's create-invoice route, so ipnCallbackUrl always points at
// nova-webhook, which only ever touches NovaUser/NovaSubscription. Fixed
// $5/month price (matches the amount already used by
// ai-system/app/quota.py's request_subscription default) — this is a
// subscription purchase, not an arbitrary wallet top-up, so the amount
// isn't user-editable like AD_BOT/MARRIAGE_BOT/JOBS_BOT's deposit pages.
const NOVA_PRO_MONTHLY_USD = 5;

export async function POST(req: NextRequest) {
  if (!isNowPaymentsConfigured()) {
    return NextResponse.json({ error: "الدفع بعملة رقمية غير مُفعَّل بعد." }, { status: 400 });
  }
  const body = await req.json().catch(() => ({}));
  const uid = String(body.uid || "").trim();
  if (!uid) return NextResponse.json({ error: "معرف مستخدم غير صالح" }, { status: 400 });

  const result = await createInvoice({
    priceAmount: NOVA_PRO_MONTHLY_USD,
    orderId: uid,
    orderDescription: "Nova AI PRO — اشتراك شهري",
    ipnCallbackUrl: `${SITE_URL}/api/payments/nova-webhook`,
    successUrl: `${SITE_URL}/pay/nova?uid=${uid}&paid=1`,
    cancelUrl: `${SITE_URL}/pay/nova?uid=${uid}`,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ invoiceUrl: result.invoiceUrl });
}
