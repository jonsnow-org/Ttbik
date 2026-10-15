import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const revalidate = 60;

export async function GET(req: NextRequest) {
  const tool = req.nextUrl.searchParams.get("tool") || "";
  const now = new Date();
  const ad = await prisma.siteBannerAd.findFirst({
    where: { kind: "sponsor", placement: tool, adStatus: "ACTIVE", endsAt: { gt: now } },
    orderBy: { startsAt: "desc" },
  }).catch(() => null);
  if (!ad) return NextResponse.json({ active: false });
  return NextResponse.json({ active: true, name: ad.altText, line: ad.bannerUrl, url: ad.targetUrl });
}
