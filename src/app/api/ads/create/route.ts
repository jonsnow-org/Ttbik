import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { makeCode, planFor } from "@/lib/siteAds";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const kind = ["image", "video", "code"].includes(body.kind) ? body.kind : "image";
  const bannerUrl = String(body.bannerUrl || "").trim();
  const targetUrl = String(body.targetUrl || "").trim();
  const altText = String(body.altText || "").trim().slice(0, 180);
  const days = Number(body.days);
  const plan = planFor(days);
  if (!plan) return NextResponse.json({ error: "المدة غير متاحة." }, { status: 400 });
  if (!/^https:\/\/.+/i.test(targetUrl)) return NextResponse.json({ error: "الرابط المستهدف يجب أن يبدأ بـ https." }, { status: 400 });
  if (altText.length < 2) return NextResponse.json({ error: "اكتب عنوان الإعلان." }, { status: 400 });
  if (kind === "code") {
    if (bannerUrl.length < 2 || bannerUrl.length > 240) return NextResponse.json({ error: "نص البنر يجب أن يكون بين كلمتين و240 حرفاً." }, { status: 400 });
  } else if (!/^https:\/\/.+/i.test(bannerUrl)) {
    return NextResponse.json({ error: "ارفع الصورة أو الفيديو أولاً." }, { status: 400 });
  }
  const ad = await prisma.siteBannerAd.create({
    data: {
      reservationCode: makeCode(),
      bannerUrl,
      targetUrl,
      altText,
      kind,
      durationDays: plan.days,
      totalPrice: plan.price,
      paymentStatus: "PENDING",
      adStatus: "PENDING_PAYMENT",
    },
  });
  return NextResponse.json({ code: ad.reservationCode, price: ad.totalPrice, days: ad.durationDays });
}
