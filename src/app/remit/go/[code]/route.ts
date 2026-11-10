import { NextRequest, NextResponse } from "next/server";
import { clickTarget } from "@/lib/remit/listings";
import { SITE_URL } from "@/lib/siteUrl";

// Outbound link of a paid listing: counted for the company's dashboard, then straight to its own site or Telegram.
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;
  const bot = /bot|crawl|spider|preview|facebookexternalhit|slurp/i.test(req.headers.get("user-agent") || "");
  const to = await clickTarget(String(code || "").toUpperCase(), !bot).catch(() => null);
  return NextResponse.redirect(to || `${SITE_URL}/remit`, 302);
}
