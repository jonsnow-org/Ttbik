import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { activateAd, creditBanner } from "@/lib/siteAds";
import { adDailyStats, adReportUrl, slaState, totals, MODERATION_SLA_HOURS } from "@/lib/adStats";

// 🛡 Promo moderation queue (protected by src/middleware.ts, /api/admin/:path*).
export const dynamic = "force-dynamic";

export async function GET() {
  const ads = await prisma.siteBannerAd.findMany({ orderBy: { createdAt: "desc" }, take: 200 }).catch(() => []);
  const rows = await Promise.all(ads.map(async (ad) => {
    const t = ad.adStatus === "ACTIVE" || ad.adStatus === "EXPIRED" ? totals(await adDailyStats(ad.reservationCode)) : { views: 0, clicks: 0, ctr: 0 };
    const waiting = ad.adStatus === "PENDING_APPROVAL" ? slaState(ad.createdAt) : null;
    return {
      code: ad.reservationCode, kind: ad.kind, placement: ad.placement, title: ad.altText, targetUrl: ad.targetUrl, bannerUrl: ad.bannerUrl,
      price: ad.totalPrice, days: ad.durationDays, paymentStatus: ad.paymentStatus, adStatus: ad.adStatus,
      createdAt: ad.createdAt, endsAt: ad.endsAt, waitingHours: waiting?.hours ?? null, late: waiting?.late ?? false,
      ...t, reportUrl: ad.paymentStatus === "PAID" ? adReportUrl(ad.reservationCode) : "",
    };
  }));
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  return NextResponse.json({
    slaHours: MODERATION_SLA_HOURS,
    stats: {
      queue: count((r) => r.adStatus === "PENDING_APPROVAL"),
      late: count((r) => r.late),
      active: count((r) => r.adStatus === "ACTIVE"),
      awaitingPayment: count((r) => r.adStatus === "PENDING_PAYMENT"),
      paidUsd: Math.round(rows.filter((r) => r.paymentStatus === "PAID").reduce((s, r) => s + r.price, 0) * 100) / 100,
    },
    ads: rows,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const code = String(body.code || "").toUpperCase();
  const action = String(body.action || "");
  const ad = await prisma.siteBannerAd.findUnique({ where: { reservationCode: code } }).catch(() => null);
  if (!ad) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (action === "confirm_paid") {
    // the moderator saw the manual USDT/bank transfer arrive
    await prisma.siteBannerAd.update({ where: { reservationCode: code }, data: { paymentStatus: "PAID", adStatus: ad.adStatus === "PENDING_PAYMENT" ? "PENDING_APPROVAL" : ad.adStatus } });
    await creditBanner(code).catch(() => null);
  } else if (action === "activate") {
    if (ad.paymentStatus !== "PAID") return NextResponse.json({ error: "غير مدفوع بعد — أكّد الدفع أولاً" }, { status: 400 });
    await activateAd(code);
  } else if (action === "reject") {
    await prisma.siteBannerAd.update({ where: { reservationCode: code }, data: { adStatus: "REJECTED", paymentStatus: ad.paymentStatus === "PAID" ? "REFUND_REVIEW" : ad.paymentStatus } });
  } else {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
