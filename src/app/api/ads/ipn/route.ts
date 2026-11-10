import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyNowPaymentsSignature } from "@/lib/nowpaymentsSignature";
import { creditBanner, notifyAdmin } from "@/lib/siteAds";

// NOWPayments IPN for site banners (ADV-…).
// Hardened 2026-11-10:
// - bad JSON → 400, not 500;
// - "confirmed" counts like "finished";
// - an unknown code is acknowledged, not a 500 retry storm;
// - an underpaid amount is ignored;
// - a re-delivered IPN never resets a live ad to PENDING_APPROVAL and never pings the admin twice.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  let body: any;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "invalid body" }, { status: 400 }); }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid body" }, { status: 400 });
  if (!verifyNowPaymentsSignature(body, req.headers.get("x-nowpayments-sig") || "")) return NextResponse.json({ error: "bad sig" }, { status: 401 });
  const code = String(body.order_id || "").toUpperCase();
  if (!code.startsWith("ADV-")) return NextResponse.json({ ok: true });
  const status = String(body.payment_status || "");
  if (status !== "finished" && status !== "confirmed") return NextResponse.json({ ok: true, ignored: status });
  const ad = await prisma.siteBannerAd.findUnique({ where: { reservationCode: code } });
  if (!ad) return NextResponse.json({ ok: true, ignored: "unknown order" });
  const paid = Number(body.price_amount);
  if (Number.isFinite(paid) && paid + 0.01 < ad.totalPrice) return NextResponse.json({ ok: true, ignored: "underpaid" });
  // Only the first PENDING → PAID transition moves the ad to review and notifies the admin.
  const moved = await prisma.siteBannerAd.updateMany({
    where: { reservationCode: code, paymentStatus: { not: "PAID" } },
    data: { paymentStatus: "PAID", adStatus: "PENDING_APPROVAL" },
  });
  await creditBanner(code).catch(() => null);
  if (moved.count === 1) {
    await notifyAdmin(`دُفع بنر ${code}\n${ad.totalPrice}$ لمدة ${ad.durationDays} يوم\n${ad.targetUrl}`, code).catch(() => null);
  }
  return NextResponse.json({ ok: true, duplicate: moved.count === 0 });
}
