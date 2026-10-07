import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code") || "";
  const ad = await prisma.siteBannerAd.findUnique({ where: { reservationCode: code } }).catch(() => null);
  if (!ad || ad.paymentStatus !== "PAID" || ad.adStatus !== "ACTIVE") return NextResponse.json({ ok: false });
  return NextResponse.json({ ok: true, kind: ad.kind, placement: ad.placement, name: ad.altText, color: ad.bannerUrl, url: ad.targetUrl });
}
