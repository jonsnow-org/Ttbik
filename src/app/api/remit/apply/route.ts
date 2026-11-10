import { NextRequest, NextResponse } from "next/server";
import { applyListing } from "@/lib/remit/listings";
import { isRateLimited, requestIp } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  if (isRateLimited(`rmt:${requestIp(req)}`, 5, 3600_000)) return NextResponse.json({ ok: false, error: "طلبات كثيرة. حاول لاحقاً." }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  const r = await applyListing({ name: b.name, country: b.country, license: b.license, corridors: b.corridors, url: b.url, contact: String(b.contact || ""), plan: b.plan, agree: b.agree === true }).catch(() => ({ ok: false as const, error: "تعذّر الحفظ." }));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
