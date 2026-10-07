import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { makeCode, planFor } from "@/lib/siteAds";

const TOOLS = new Set(["qr-generator", "bmi-calculator", "guess-word"]);

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const kind = ["image", "video", "code", "sponsor", "embed", "bulk"].includes(body.kind) ? body.kind : "image";
  const bannerUrl = String(body.bannerUrl || "").trim();
  const targetUrl = String(body.targetUrl || "https://ttbik.vercel.app").trim();
  const altText = String(body.altText || "").trim().slice(0, 180);
  const placement = TOOLS.has(body.placement) ? body.placement : "sitewide";
  const days = Number(body.days);
  let plan = planFor(days);
  if (kind === "embed") plan = { days: 365, price: 10, label: "رابط دائم" };
  if (kind === "bulk") plan = { days: 7, price: 3, label: "ملف رموز" };
  if (!plan) return NextResponse.json({ error: "المدة غير متاحة." }, { status: 400 });
  if (altText.length < 2) return NextResponse.json({ error: "اكتب الاسم أو العنوان." }, { status: 400 });
  if (kind === "sponsor" && placement === "sitewide") return NextResponse.json({ error: "اختر الأداة." }, { status: 400 });
  if (kind === "code" || kind === "sponsor") {
    if (bannerUrl.length < 2) return NextResponse.json({ error: "اكتب سطر الرعاية أو النص." }, { status: 400 });
  } else if (kind !== "bulk" && !/^https:\/\/.+/i.test(bannerUrl)) {
    return NextResponse.json({ error: "ارفع الملف أو ضع رابطاً يبدأ بـ https." }, { status: 400 });
  }
  if (!/^https:\/\/.+/i.test(targetUrl)) return NextResponse.json({ error: "الرابط يجب أن يبدأ بـ https." }, { status: 400 });
  const ad = await prisma.siteBannerAd.create({
    data: {
      reservationCode: makeCode(),
      bannerUrl: bannerUrl || "bulk",
      targetUrl,
      altText,
      kind,
      placement,
      durationDays: plan.days,
      totalPrice: plan.price,
      paymentStatus: "PENDING",
      adStatus: "PENDING_PAYMENT",
    },
  });
  return NextResponse.json({ code: ad.reservationCode, price: ad.totalPrice, days: ad.durationDays, kind });
}
