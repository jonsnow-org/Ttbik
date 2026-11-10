import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const site = (process.env.NEXT_PUBLIC_SITE_URL || "https://ttbik-gate.jonsnowx1r.workers.dev").replace(/\/$/, "");
  const state = req.nextUrl.searchParams.get("state") || "";
  return NextResponse.redirect(`${site}/youtube/link?state=${encodeURIComponent(state)}`);
}
