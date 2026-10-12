import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const revalidate = 60;

export async function GET() {
  const now = new Date();
  await prisma.siteBannerAd.updateMany({
    where: { adStatus: "ACTIVE", endsAt: { lte: now } },
    data: { adStatus: "EXPIRED" },
  }).catch(() => null);
  const ad = await prisma.siteBannerAd.findFirst({
    where: { adStatus: "ACTIVE", endsAt: { gt: now }, placement: "sitewide", kind: { in: ["image", "video", "code"] } },
    orderBy: { startsAt: "desc" },
  }).catch(() => null);
  if (!ad) return NextResponse.json({ active: false });
  return NextResponse.json({
    active: true,
    bannerUrl: ad.bannerUrl,
    targetUrl: ad.targetUrl,
    altText: ad.altText,
    kind: ad.kind,
    endsAt: ad.endsAt,
  });
}
