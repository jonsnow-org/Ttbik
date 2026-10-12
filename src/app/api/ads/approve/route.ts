import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { activateAd } from "@/lib/siteAds";

function allowed(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") || "";
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.NOWPAYMENTS_IPN_SECRET || "";
  return Boolean(secret) && key === secret;
}

export async function GET(req: NextRequest) {
  if (!allowed(req)) return new NextResponse("مرفوض", { status: 401 });
  const code = String(req.nextUrl.searchParams.get("code") || "").toUpperCase();
  await prisma.siteBannerAd.update({
    where: { reservationCode: code },
    data: { paymentStatus: "PAID" },
  }).catch(() => null);
  const ad = await activateAd(code);
  if (!ad || ad.adStatus !== "ACTIVE") return new NextResponse("لم يُفعَّل. تأكد أن الدفع مؤكد.", { status: 400 });
  return new NextResponse(`الإعلان ${code} أصبح نشطاً حتى ${ad.endsAt?.toISOString()}`);
}
