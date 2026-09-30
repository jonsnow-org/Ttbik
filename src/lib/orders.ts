import { supabaseAdmin } from "./supabase";
import { editOrderAlert } from "./telegram";

export type Decision = "approved" | "rejected";

/**
 * Single source of truth for approving/rejecting an order — used by both the
 * Telegram webhook (admin taps a button in the chat) and the web admin
 * dashboard (admin clicks a button on the site). Automatically delivers the
 * service's access link/key to the customer's order-tracking page on approval.
 */
export async function decideOrder(orderId: string, decision: Decision, note?: string) {
  const db = supabaseAdmin();

  const { data: order, error } = await db
    .from("orders")
    .select("*, services(name_ar, slug, delivery_content, tool_route)")
    .eq("id", orderId)
    .single();

  if (error || !order) throw new Error("الطلب غير موجود");
  if (order.status !== "pending") return order; // already decided, no-op

  // Hosted /tools/* pages were retired (2026-09-25), so there is no tool
  // link to hand out any more; delivery comes from the note or the service.
  const toolLink: string | null = null;

  const deliveryContent =
    decision === "approved" ? note?.trim() || toolLink || order.services?.delivery_content || null : null;

  const { data: updated, error: updateError } = await db
    .from("orders")
    .update({
      status: decision,
      delivery_content: deliveryContent,
      admin_note: note ?? null,
      decided_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .select()
    .single();

  if (updateError) throw updateError;

  await db.from("notifications").insert({
    order_id: orderId,
    channel: "site",
    message:
      decision === "approved"
        ? `تمت الموافقة على الطلب ${order.order_code} وتسليم الخدمة تلقائياً.`
        : `تم رفض الطلب ${order.order_code}.`,
  });

  if (order.telegram_chat_id && order.telegram_message_id) {
    await editOrderAlert(
      order.telegram_chat_id,
      order.telegram_message_id,
      decision === "approved"
        ? `✅ تمت الموافقة على الطلب ${order.order_code} وتسليم الخدمة تلقائياً للعميل.`
        : `❌ تم رفض الطلب ${order.order_code}.`
    );
  }

  return updated;
}

/**
 * True when this on-chain transaction hash already paid for ANOTHER approved
 * order. One real USDT transfer must never approve more than one order --
 * without this, a single $5 transaction hash could be pasted into any number
 * of orders and each would auto-approve. Only well-formed 64-hex hashes are
 * looked up (also keeps user text out of the ilike pattern); anything else
 * cannot be auto-verified anyway.
 */
export async function usdtHashAlreadyUsed(txHash: string, exceptOrderId: string): Promise<boolean> {
  const hash = (txHash || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) return false;
  const db = supabaseAdmin();
  const { data } = await db
    .from("orders")
    .select("id")
    .eq("payment_method", "usdt")
    .eq("status", "approved")
    .neq("id", exceptOrderId)
    .ilike("transfer_reference", hash)
    .limit(1);
  return !!(data && data.length > 0);
}
