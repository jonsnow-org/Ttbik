import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { decideOrder } from "@/lib/orders";
import { usdtAutoVerifySupported, verifyTrc20UsdtPayment } from "@/lib/usdtVerify";
import { sendAdminNotice } from "@/lib/telegram";
import { isRateLimited, requestIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * Polled from the order-status page (StatusPoller) for a still-pending USDT
 * order -- a transaction can take longer than the single check-at-creation
 * attempt in /api/orders to confirm/index, so this keeps retrying
 * automatically until it does, with no admin action needed. A no-op for
 * every other case (order not found/not pending/not usdt), so it's safe to
 * call unconditionally from the client on every poll tick.
 */
export async function POST(req: NextRequest) {
  const { orderCode } = await req.json().catch(() => ({}));
  if (typeof orderCode !== "string" || !orderCode.trim()) {
    return NextResponse.json({ done: false });
  }

  const code = orderCode.trim().toUpperCase();
  if (isRateLimited(`verify-usdt:${requestIp(req)}`, 60, 5 * 60 * 1000) || isRateLimited(`verify-usdt:code:${code}`, 40, 5 * 60 * 1000)) {
    return NextResponse.json({ done: false });
  }

  const db = supabaseAdmin();
  const { data: order } = await db
    .from("orders")
    .select("id, order_code, status, payment_method, transfer_reference, amount_usd, services(name_ar)")
    .eq("order_code", code)
    .single();

  if (!order || order.status !== "pending" || order.payment_method !== "usdt") {
    return NextResponse.json({ done: false });
  }

  const usdtAddress = (process.env.USDT_ADDRESS || "").trim();
  const usdtNetwork = process.env.USDT_NETWORK || "TRC20";
  if (!usdtAddress || !usdtAutoVerifySupported(usdtNetwork)) {
    return NextResponse.json({ done: false });
  }

  const check = await verifyTrc20UsdtPayment(order.transfer_reference, usdtAddress, order.amount_usd);
  if (!check.ok) {
    return NextResponse.json({ done: false, reason: check.reason });
  }

  try {
    await decideOrder(order.id, "approved");
    const serviceName = (order.services as unknown as { name_ar?: string } | null)?.name_ar || "";
    await sendAdminNotice(
      `✅ تحقّق تلقائي من الشبكة: طلب ${order.order_code} (${serviceName}) — تم تأكيد دفع USDT على البلوكتشين والموافقة عليه تلقائياً.`
    );
    return NextResponse.json({ done: true });
  } catch (e) {
    console.error("auto-approve (polled) after usdt verify failed:", e);
    return NextResponse.json({ done: false });
  }
}
