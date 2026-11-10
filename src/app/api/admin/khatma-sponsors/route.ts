import { NextRequest, NextResponse } from "next/server";
import { adminSponsorAction, adminSponsors, khatmaStats } from "@/lib/khatma/khatma";
import { isOwnerRequest } from "@/lib/isOwner";

// 🌙 Khatma sponsors + stats (admin; also protected by src/middleware.ts).
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!isOwnerRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [sponsors, stats] = await Promise.all([adminSponsors(), khatmaStats()]);
  return NextResponse.json({ sponsors, stats });
}
export async function POST(req: NextRequest) {
  if (!isOwnerRequest(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const action = b.action === "stop" ? "stop" : b.action === "confirm_paid" ? "confirm_paid" : null;
  if (!action) return NextResponse.json({ ok: false }, { status: 400 });
  const r = await adminSponsorAction(String(b.code || "").toUpperCase(), action);
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
