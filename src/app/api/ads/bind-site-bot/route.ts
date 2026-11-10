import { NextRequest, NextResponse } from "next/server";
import { bindSiteBot } from "@/lib/siteAds";
import { isOwnerRequest } from "@/lib/isOwner";

// Owner only: re-points the site bot's Telegram webhook (/api/ads/telegram) and Mini App menu button at the gate.
// Changes nothing in the database. Needs the same admin cookie as every /api/admin route.
export async function POST(req: NextRequest) {
  if (!isOwnerRequest(req)) return NextResponse.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const result = await bindSiteBot();
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
