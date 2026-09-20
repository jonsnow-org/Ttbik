import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { generateOrderCode } from "@/lib/utils";
import { sendOrderAlert, sendAdminNotice } from "@/lib/telegram";
import { isRateLimited, requestIp } from "@/lib/rateLimit";
import { decideOrder } from "@/lib/orders";
import { usdtAutoVerifySupported, verifyTrc20UsdtPayment } from "@/lib/usdtVerify";

export async function POST(req: NextRequest) {
  // Public endpoint, no auth — without this, a burst of fake orders each
  // writes a DB row and fires a Telegram alert, wasting the free API quota
  // and flooding the owner's notification chat.
  if (isRateLimited(`orders:${requestIp(req)}`, 5, 10 * 60 * 1000)) {
    return NextResponse.json({ error: "طلبات كثيرة جداً، حاول لاحقاً." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const { serviceId, customerName, customerContact, paymentMethod, transferReference } = body ?? {};

  if (!serviceId || !customerName || !customerContact || !paymentMethod || !transferReference) {
    return NextResponse.json({ error: "بيانات ناقصة" }, { status: 400 });
  }
  if (!["bank", "usdt"].includes(paymentMethod)) {
    return NextResponse.json({ error: "طريقة دفع غير صالحة" }, { status: 400 });
  }

  const db = supabaseAdmin();

  const { data: service, error: serviceError } = await db
    .from("services")
    .select("id, name_ar, price_usd, is_active")
    .eq("id", serviceId)
    .single();

  if (serviceError || !service || !service.is_active) {
    return NextResponse.json({ error: "الخدمة غير متوفرة" }, { status: 404 });
  }

  const { data: customer } = await db
    .from("customers")
    .insert({ name: customerName, contact: customerContact })
    .select()
    .single();

  const orderCode = generateOrderCode();

  const { data: order, error: orderError } = await db
    .from("orders")
    .insert({
      order_code: orderCode,
      service_id: service.id,
      customer_id: customer?.id ?? null,
      customer_name: customerName,
      customer_contact: customerContact,
      payment_method: paymentMethod,
      transfer_reference: transferReference,
      amount_usd: service.price_usd,
      status: "pending",
    })
    .select()
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "تعذّر إنشاء الطلب" }, { status: 500 });
  }

  await db.from("notifications").insert({
    order_id: order.id,
    channel: "site",
    message: `طلب جديد ${order.order_code} بانتظار المراجعة.`,
  });

  // Manual payment confirmation must be automatic, not admin-reviewed
  // (owner decision 2026-09-20) -- for USDT specifically, the customer's
  // transferReference IS the on-chain transaction hash, so we can check
  // TRON's own public ledger for a real, confirmed transfer instead of
  // waiting on a human. If the transaction hasn't confirmed/indexed yet,
  // /api/orders/verify-usdt (polled from the order-status page) keeps
  // retrying automatically -- this single attempt here just catches the
  // common case where the customer already paid before submitting the form.
  const usdtAddress = (process.env.USDT_ADDRESS || "").trim();
  const usdtNetwork = process.env.USDT_NETWORK || "TRC20";
  if (paymentMethod === "usdt" && usdtAddress && usdtAutoVerifySupported(usdtNetwork)) {
    const check = await verifyTrc20UsdtPayment(transferReference, usdtAddress, service.price_usd);
    if (check.ok) {
      try {
        await decideOrder(order.id, "approved");
        await sendAdminNotice(
          `✅ تحقّق تلقائي من الشبكة: طلب ${order.order_code} (${service.name_ar}) — تم تأكيد دفع USDT على البلوكتشين والموافقة عليه تلقائياً.`
        );
        return NextResponse.json({ orderCode: order.order_code });
      } catch (e) {
        console.error("auto-approve after usdt verify failed:", e);
      }
    }
  }

  const tg = await sendOrderAlert({
    orderId: order.id,
    orderCode: order.order_code,
    serviceName: service.name_ar,
    priceUsd: service.price_usd,
    customerName,
    customerContact,
    paymentMethod,
    transferReference,
  });

  if (tg.message_id && tg.chat_id) {
    await db
      .from("orders")
      .update({ telegram_message_id: tg.message_id, telegram_chat_id: tg.chat_id })
      .eq("id", order.id);
  }

  return NextResponse.json({ orderCode: order.order_code });
}
