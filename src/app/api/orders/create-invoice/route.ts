import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/supabase";
import { generateOrderCode } from "@/lib/utils";
import { sendOrderAlert } from "@/lib/telegram";
import { createInvoice, isNowPaymentsConfigured } from "@/lib/nowpayments";
import { isRateLimited, requestIp } from "@/lib/rateLimit";

// Real, automated checkout for the /service catalog — same NOWPayments
// gateway already used for bot-wallet deposits (see api/payments/create-invoice),
// wired to the site's own orders table instead. The order row is created
// up front with a pre-generated id so that id can double as NOWPayments'
// order_id, letting the webhook find it back with a single lookup — no
// separate invoice-id column needed.
export async function POST(req: NextRequest) {
  if (isRateLimited(`orders-invoice:${requestIp(req)}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "طلبات كثيرة جداً، حاول لاحقاً." }, { status: 429 });
  }
  if (!isNowPaymentsConfigured()) {
    return NextResponse.json({ error: "الدفع التلقائي غير مُفعَّل بعد." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const { serviceId, customerName, customerContact } = body ?? {};
  if (!serviceId || !customerName?.trim() || !customerContact?.trim()) {
    return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 });
  }

  const db = supabaseAdmin();

  const { data: service, error: serviceError } = await db
    .from("services")
    .select("id, slug, name_ar, price_usd, is_active")
    .eq("id", serviceId)
    .single();

  if (serviceError || !service || !service.is_active) {
    return NextResponse.json({ error: "الخدمة غير متوفرة" }, { status: 404 });
  }
  if (!service.price_usd || service.price_usd <= 0) {
    return NextResponse.json({ error: "هذه الخدمة مجانية، لا حاجة للدفع." }, { status: 400 });
  }

  const { data: customer } = await db
    .from("customers")
    .insert({ name: customerName, contact: customerContact })
    .select()
    .single();

  const orderId = crypto.randomUUID();
  const orderCode = generateOrderCode();
  const base = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik-gate.jonsnowx1r.workers.dev").replace(/\/$/, "");

  const invoice = await createInvoice({
    priceAmount: service.price_usd,
    orderId,
    orderDescription: `${service.name_ar} — ${orderCode}`,
    ipnCallbackUrl: `${base}/api/orders/payment-webhook`,
    successUrl: `${base}/order/${orderCode}`,
    cancelUrl: `${base}/service/${service.slug}`,
  });

  if (!invoice.ok || !invoice.invoiceUrl) {
    return NextResponse.json({ error: invoice.error || "تعذّر إنشاء فاتورة الدفع" }, { status: 502 });
  }

  const { data: order, error: orderError } = await db
    .from("orders")
    .insert({
      id: orderId,
      order_code: orderCode,
      service_id: service.id,
      customer_id: customer?.id ?? null,
      customer_name: customerName,
      customer_contact: customerContact,
      payment_method: "crypto_auto",
      transfer_reference: invoice.invoiceUrl,
      amount_usd: service.price_usd,
      status: "pending",
    })
    .select()
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "تعذّر إنشاء الطلب" }, { status: 500 });
  }

  const tg = await sendOrderAlert({
    orderId: order.id,
    orderCode: order.order_code,
    serviceName: service.name_ar,
    priceUsd: service.price_usd,
    customerName,
    customerContact,
    paymentMethod: "crypto_auto",
    transferReference: "بانتظار تأكيد الدفع التلقائي عبر NOWPayments",
  });

  if (tg.message_id && tg.chat_id) {
    await db
      .from("orders")
      .update({ telegram_message_id: tg.message_id, telegram_chat_id: tg.chat_id })
      .eq("id", order.id);
  }

  return NextResponse.json({ orderCode: order.order_code, invoiceUrl: invoice.invoiceUrl });
}
