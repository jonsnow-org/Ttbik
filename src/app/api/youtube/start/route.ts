import { publicSiteUrl } from "@/lib/siteUrl";
import { NextRequest, NextResponse } from "next/server";
import { youtubeStartUrl } from "@/lib/youtubeLink";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const tg = req.nextUrl.searchParams.get("tg") || "";
  const site = publicSiteUrl();
  const url = youtubeStartUrl(site, tg);
  if (!url) return new NextResponse("YouTube linking is not configured", { status: 503 });
  return NextResponse.redirect(url);
}
