import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bindAdmenBot } from "@/lib/siteAds";

export async function GET() {
  const now = new Date();
  const result = await prisma.siteBannerAd.updateMany({
    where: { adStatus: "ACTIVE", endsAt: { lte: now } },
    data: { adStatus: "EXPIRED" },
  });
  const bound = await bindAdmenBot().catch(() => ({ ok: false }));
  return NextResponse.json({ expired: result.count, admen: bound.ok });
}
