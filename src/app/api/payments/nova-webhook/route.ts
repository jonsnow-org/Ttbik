import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyNowPaymentsSignature } from "@/lib/nowpaymentsSignature";

// NOVA_BOT's own NOWPayments IPN consumer — automates what was previously
// a manual-only flow (owner flipping NovaSubscription.status via the
// Supabase table editor). A confirmed payment here immediately activates
// PRO for 30 days; the manual approval path in ai-system/app/quota.py's
// request_subscription still exists as a fallback for anyone who can't
// pay by crypto, exactly like every other bot on this platform.
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET || "";
  const signature = req.headers.get("x-nowpayments-sig") || "";
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid body" }, { status: 400 });
  if (!secret) return NextResponse.json({ error: "not configured" }, { status: 503 });

  if (!verifyNowPaymentsSignature(body, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const status = String(body.payment_status || "");
  if (status !== "finished" && status !== "confirmed") {
    return NextResponse.json({ ok: true }); // still pending — nothing to activate yet
  }

  const novaUserId = String(body.order_id || "");
  const amount = Number(body.price_amount || 0);
  const paymentId = String(body.payment_id || body.invoice_id || "");
  if (!novaUserId || !paymentId) {
    return NextResponse.json({ error: "bad order_id" }, { status: 400 });
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + THIRTY_DAYS_MS);

  try {
    // Idempotency: paymentId as the subscription row's own id — a
    // duplicate IPN retry fails this insert (unique PK) and we skip
    // activating twice, same pattern as every other webhook here (which
    // use a unique txHash instead, since their tables are wallet ledgers
    // rather than subscription records).
    await prisma.novaSubscription.create({
      data: {
        id: paymentId,
        novaUserId,
        plan: "PRO_MONTHLY",
        amountUsd: amount || 5,
        status: "ACTIVE",
        approvedBy: "NOWPAYMENTS_AUTO",
        startedAt: now,
        expiresAt,
      },
    });
  } catch {
    return NextResponse.json({ ok: true }); // already activated
  }

  await prisma.novaUser
    .update({ where: { id: novaUserId }, data: { plan: "PRO", subscriptionExpiresAt: expiresAt } })
    .catch((e) => console.error("[nova-webhook] plan activation failed — NovaUser missing?", { novaUserId, error: e }));

  return NextResponse.json({ ok: true });
}
