import { publicSiteUrl } from "@/lib/siteUrl";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const site = publicSiteUrl();
  const state = req.nextUrl.searchParams.get("state") || "";
  return NextResponse.redirect(`${site}/youtube/link?state=${encodeURIComponent(state)}`);
}
