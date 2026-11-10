import { NextRequest, NextResponse } from "next/server";
import { createSponsorOrder, paySponsor } from "@/lib/khatma/khatma";
import { isRateLimited, requestIp } from "@/lib/rateLimit";

// 🌙 Khatma sponsorship. POST {action:"create", name, url, contact} | {action:"pay", code, method}.
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  if (isRateLimited(`ksp:${requestIp(req)}`, 10, 600_000)) return NextResponse.json({ ok: false, error: "طلبات كثيرة. حاول بعد دقائق." }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  let r: { ok: boolean; error?: string };
  if (b?.action === "pay") {
    const m = ["stars", "nowpayments", "usdt"].includes(b.method) ? b.method : "usdt";
    r = await paySponsor(String(b.code || "").toUpperCase(), m).catch(() => ({ ok: false, error: "تعذّر إنشاء الدفع." }));
  } else {
    r = await createSponsorOrder({ name: String(b.name || ""), url: String(b.url || ""), contact: String(b.contact || "") }).catch(() => ({ ok: false, error: "تعذّر الحفظ." }));
  }
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
