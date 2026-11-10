import { NextRequest, NextResponse } from "next/server";
import { checkListingUsdt, clicksByDay, listingByCode, payListing, secretOk } from "@/lib/remit/listings";
import { isRateLimited, requestIp } from "@/lib/rateLimit";

// POST {action:"pay", code, k, method} | {action:"check", code, k}: the company's private dashboard (k = its secret key).
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  if (isRateLimited(`rmtl:${requestIp(req)}`, 60, 600_000)) return NextResponse.json({ ok: false, error: "طلبات كثيرة." }, { status: 429 });
  const b = await req.json().catch(() => ({}));
  const code = String(b.code || "").toUpperCase(), k = String(b.k || "");
  if (b.action === "pay") {
    const m = ["usdt", "nowpayments", "stars"].includes(b.method) ? b.method : "usdt";
    const r = await payListing(code, k, m).catch(() => ({ ok: false as const, error: "تعذّر إنشاء الدفع." }));
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }
  const l = await listingByCode(code).catch(() => null);
  if (!l || !secretOk(l, k)) return NextResponse.json({ ok: false, error: "الرابط غير صحيح." }, { status: 404 });
  const paid = ["APPROVED", "ACTIVE", "EXPIRED"].includes(l.status) ? await checkListingUsdt(code).catch(() => false) : false;
  const fresh = paid ? await listingByCode(code) : l;
  const days = await clicksByDay(code).catch(() => []);
  return NextResponse.json({ ok: true, paid, status: fresh?.status, ends_at: fresh?.ends_at, clicks: fresh?.clicks ?? 0, days: days.map((d) => ({ day: d.day.toISOString().slice(0, 10), n: d.n })) });
}
