import { NextRequest, NextResponse } from "next/server";
import { auditByUsername } from "@/lib/channels/exchange";
import { isRateLimited, requestIp } from "@/lib/rateLimit";

// Free channel audit (public). Cached 6 h per channel; 20 lookups / 10 min per IP.
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (isRateLimited(`ch-audit:${requestIp(req)}`, 20, 600_000)) return NextResponse.json({ ok: false, error: "طلبات كثيرة. حاول بعد دقائق." }, { status: 429 });
  const u = req.nextUrl.searchParams.get("u") || "";
  const r = await auditByUsername(u).catch(() => ({ ok: false as const, error: "تعذّر الفحص الآن." }));
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
