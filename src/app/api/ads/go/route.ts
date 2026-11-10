import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { recordAdEvent } from "@/lib/adStats";
import { isMachineUserAgent } from "@/lib/botUserAgent";
import { SITE_URL } from "@/lib/siteUrl";

// Click-through for paid banners: counts a human click for the advertiser's report, then 302s to the ad's target.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const code = String(req.nextUrl.searchParams.get("c") || "").toUpperCase().slice(0, 40);
  const ad = code ? await prisma.siteBannerAd.findUnique({ where: { reservationCode: code } }).catch(() => null) : null;
  if (!ad || ad.adStatus !== "ACTIVE" || !/^https:\/\//i.test(ad.targetUrl)) return NextResponse.redirect(SITE_URL, 302);
  if (!isMachineUserAgent(req.headers.get("user-agent") || "")) await recordAdEvent(code, "click");
  return NextResponse.redirect(ad.targetUrl, 302);
}
