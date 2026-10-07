import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { makeCode, planFor } from "@/lib/siteAds";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bannerUrl = String(body.bannerUrl || "").trim();
  const targetUrl = String(body.targetUrl || "").trim();
  const altText = String(body.altText || "").trim().slice(0, 120);
  const days = Number(body.days);
  const plan = planFor(days);
  if (!plan) return NextResponse.json({ error: "المدة غير متاحة." }, { status: 400 });
  if (!/^https:\/\/.+/i.test(bannerUrl) || !/^https:\/\/.+/i.test(targetUrl)) {
    return NextResponse.json({ error: "رابط البنر والرابط المستهدف يجب أن يبدآ بـ https." }, { status: 400 });
  }
  if (altText.length < 2) return NextResponse.json({ error: "اكتب عنوان الإعلان." }, { status: 400 });

  const reservationCode = makeCode();
  const ad = await prisma.siteBannerAd.create({
    data: {
      reservationCode,
      bannerUrl,
      targetUrl,
      altText,
      durationDays: plan.days,
      totalPrice: plan.price,
      paymentStatus: "PENDING",
      adStatus: "PENDING_PAYMENT",
    },
  });
  return NextResponse.json({ code: ad.reservationCode, price: ad.totalPrice, days: ad.durationDays });
}
