import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyNowPaymentsSignature } from "@/lib/nowpaymentsSignature";
import { markSiteAdPaid } from "@/lib/siteAds";
import { markDealPaid } from "@/lib/channels/exchange";
import { markSponsorPaid } from "@/lib/khatma/khatma";
import { markListingPaid } from "@/lib/remit/listings";
import { BOT_PAID_USD, codeMessage, markBotOrderPaid } from "@/lib/botSales";
import { deliverBotCode } from "@/lib/botSalesChat";
import { gateUrl } from "@/lib/hostingOps";

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
  const status = String(body.payment_status || "");
  // Channel ad deals (CHD-), badges (CHB-) and asset sales (CHM-): money remains held until proof is complete.
  if (code.startsWith("CHD-") || code.startsWith("CHB-") || code.startsWith("CHM-")) {
    if (status !== "finished" && status !== "confirmed") return NextResponse.json({ ok: true, ignored: status });
    const providerRef = String(body.payin_hash || body.payment_id || "").trim().slice(0, 160);
    const r = await markDealPaid(code, "NOWPayments", Number(body.price_amount), providerRef || undefined);
    return NextResponse.json({ ok: true, duplicate: !r.first, accepted: r.ok });
  }
  // 🌙 Khatma sponsorship slots (KSP-).
  if (code.startsWith("KSP-")) {
    if (status !== "finished" && status !== "confirmed") return NextResponse.json({ ok: true, ignored: status });
    const r = await markSponsorPaid(code, "NOWPayments", Number(body.price_amount));
    return NextResponse.json({ ok: true, duplicate: !r.first, accepted: r.ok });
  }
  // 🏦 Remittance listings (RMT-XXXXXXXX-<invoice suffix>): each invoice extends the listing once.
  if (code.startsWith("RMT-")) {
    if (status !== "finished" && status !== "confirmed") return NextResponse.json({ ok: true, ignored: status });
    const r = await markListingPaid(code.slice(0, 12), `NOWPayments ${code}`.slice(0, 120), Number(body.price_amount));
    return NextResponse.json({ ok: true, duplicate: !r.first, accepted: r.ok });
  }
  // 🤖 builder activation codes (BOT-<purchase id>): the code is minted and sent to the buyer on the confirmed payment.
  if (code.startsWith("BOT-")) {
    if (status !== "finished" && status !== "confirmed") return NextResponse.json({ ok: true, ignored: status });
    const paid = Number(body.price_amount);
    if (Number.isFinite(paid) && paid + 0.01 < BOT_PAID_USD) return NextResponse.json({ ok: true, ignored: "underpaid" });
    const r = await markBotOrderPaid(String(body.order_id).slice(4).toLowerCase(), "NOWPayments").catch(() => ({ first: false, code: null, buyerId: null }));
    if (r.first && r.code && r.buyerId) {
      await deliverBotCode(r.buyerId, codeMessage(r.code, r.buyerId, gateUrl(), false)).catch(() => null);
    }
    return NextResponse.json({ ok: true, duplicate: !r.first });
  }
  if (!code.startsWith("ADV-")) return NextResponse.json({ ok: true });
  if (status !== "finished" && status !== "confirmed") return NextResponse.json({ ok: true, ignored: status });
  const ad = await prisma.siteBannerAd.findUnique({ where: { reservationCode: code } });
  if (!ad) return NextResponse.json({ ok: true, ignored: "unknown order" });
  const paid = Number(body.price_amount);
  if (Number.isFinite(paid) && paid + 0.01 < ad.totalPrice) return NextResponse.json({ ok: true, ignored: "underpaid" });
  const r = await markSiteAdPaid(code, "NOWPayments");
  return NextResponse.json({ ok: true, duplicate: !r.first });
}
