import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { bindSiteBot } from "@/lib/siteAds";
import { isCronAuthorized } from "@/lib/cronAuth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const now = new Date();
  const result = await prisma.siteBannerAd.updateMany({
    where: { adStatus: "ACTIVE", endsAt: { lte: now } },
    data: { adStatus: "EXPIRED" },
  });
  const bound = await bindSiteBot().catch(() => ({ ok: false }));
  return NextResponse.json({ expired: result.count, siteBot: bound.ok });
}
