import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyNowPaymentsSignature } from "@/lib/nowpaymentsSignature";
import { creditOnce } from "@/lib/paymentCredit";

// CONFESSION_BOT's own NOWPayments IPN consumer — a separate route from
// every other bot's *-webhook route, so a deposit here only ever touches
// ConfessionUser/ConfessionTransaction, never any other bot's ledger.
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
    return NextResponse.json({ ok: true }); // still pending — nothing to credit yet
  }

  const userId = String(body.order_id || "");
  const amount = Number(body.price_amount || 0);
  const externalId = String(body.payment_id || body.invoice_id || userId);
  if (!userId || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "bad order_id" }, { status: 400 });
  }

  // Idempotency + atomicity: see creditOnce (unique txHash, one DB transaction).
  const result = await creditOnce(
    "confession-webhook",
    (tx) => tx.confessionTransaction.create({
      data: { userId, amount, currency: "crypto", type: "DEPOSIT", status: "COMPLETED", txHash: externalId },
    }),
    (tx) => tx.confessionUser.update({ where: { id: userId }, data: { balance: { increment: amount } } }),
  );
  if (result === "retry") return NextResponse.json({ error: "retry" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
