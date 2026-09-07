import { NextRequest, NextResponse } from "next/server";
import { createInvoice, isNowPaymentsConfigured } from "@/lib/nowpayments";
import { SITE_URL } from "@/lib/siteUrl";

// NOVA_BOT's own subscription invoice — a separate route from every other
// bot's create-invoice route, so ipnCallbackUrl always points at
// nova-webhook, which only ever touches NovaUser/NovaSubscription.
//
// Owner spec, 2026-09-08: tiered plans (PRO_BASIC/PRO_PLUS/PRO_ULTRA)
// replaced the old flat $5 price. The price is looked up here from the
// FastAPI backend's /plans endpoint (ai-system/app/quota.py's PLANS
// dict — the single source of truth) rather than trusted from the
// client, since a tampered client-sent amount would otherwise let
// someone buy the top tier for a penny. NOWPayments' order_id is a
// plain string with no room for a second field, so plan is encoded
// into it as "<uid>:<plan>" and split back apart in nova-webhook.
const FASTAPI_URL = process.env.NOVA_FASTAPI_URL || "";

export async function POST(req: NextRequest) {
  if (!isNowPaymentsConfigured()) {
    return NextResponse.json({ error: "الدفع بعملة رقمية غير مُفعَّل بعد." }, { status: 400 });
  }
  if (!FASTAPI_URL) {
    return NextResponse.json({ error: "NOVA_FASTAPI_URL غير مُعدّ على Vercel." }, { status: 500 });
  }
  const body = await req.json().catch(() => ({}));
  const uid = String(body.uid || "").trim();
  const plan = String(body.plan || "").trim();
  if (!uid) return NextResponse.json({ error: "معرف مستخدم غير صالح" }, { status: 400 });
  if (!plan) return NextResponse.json({ error: "لم يتم اختيار خطة" }, { status: 400 });

  let priceUsd: number;
  let planLabel: string;
  try {
    const plansRes = await fetch(`${FASTAPI_URL}/plans`, { cache: "no-store" });
    const plansData = await plansRes.json();
    const planInfo = plansData?.plans?.[plan];
    if (!planInfo || plan === "FREE") return NextResponse.json({ error: "خطة غير صالحة" }, { status: 400 });
    priceUsd = planInfo.price_usd;
    planLabel = planInfo.label;
  } catch {
    return NextResponse.json({ error: "تعذر جلب سعر الخطة — حاول مرة أخرى." }, { status: 502 });
  }

  const result = await createInvoice({
    priceAmount: priceUsd,
    orderId: `${uid}:${plan}`,
    orderDescription: `Nova AI — اشتراك ${planLabel}`,
    ipnCallbackUrl: `${SITE_URL}/api/payments/nova-webhook`,
    successUrl: `${SITE_URL}/pay/nova?uid=${uid}&paid=1`,
    cancelUrl: `${SITE_URL}/pay/nova?uid=${uid}`,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ invoiceUrl: result.invoiceUrl });
}
