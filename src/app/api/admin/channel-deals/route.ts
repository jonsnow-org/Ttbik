import { NextRequest, NextResponse } from "next/server";
import { adminDealAction, adminDeals } from "@/lib/channels/exchange";
import { adminAssetMarketAction } from "@/lib/channels/assetMarket";
import { isOwnerRequest } from "@/lib/isOwner";

// 📣 Channel exchange escrow (admin; also protected by src/middleware.ts for /api/admin/:path*).
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!isOwnerRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await adminDeals());
}
export async function POST(req: NextRequest) {
  if (!isOwnerRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const action = String(b.action || "");
  if (["approve_asset_listing", "reject_asset_listing"].includes(action)) {
    const r = await adminAssetMarketAction(String(b.id || ""), action === "approve_asset_listing" ? "approve_listing" : "reject_listing", String(b.reference || ""));
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  if (!["confirm_paid", "verify", "release", "refund", "cancel"].includes(action)) return NextResponse.json({ ok: false, error: "bad action" }, { status: 400 });
  const r = await adminDealAction(String(b.code || "").toUpperCase(), action as "confirm_paid" | "verify" | "release" | "refund" | "cancel", String(b.reference || ""));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
