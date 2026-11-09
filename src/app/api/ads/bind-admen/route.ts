import { NextRequest, NextResponse } from "next/server";
import { bindAdmenBot } from "@/lib/siteAds";
import { isOwnerRequest } from "@/lib/isOwner";

// Owner only: this rewrites the @Admen10bot row (deactivates it, changes its template) and re-points its Telegram webhook and menu
// button. It used to be open to anyone on the internet; now it needs the same admin cookie as every /api/admin route.
export async function POST(req: NextRequest) {
  if (!isOwnerRequest(req)) return NextResponse.json({ ok: false, error: "غير مصرح" }, { status: 401 });
  const result = await bindAdmenBot();
  return NextResponse.json(result, { status: result.ok ? 200 : 404 });
}
