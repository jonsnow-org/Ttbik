import { NextRequest, NextResponse } from "next/server";
import { checkSponsorUsdt, createSponsorOrder, paySponsor, sponsorByCode } from "@/lib/khatma/khatma";
import { sponsorPrizes } from "@/lib/contests/prizes";
import { isRateLimited, requestIp } from "@/lib/rateLimit";

// 🌙 Khatma / 🏆 contest sponsorship.
// POST {action:"create", name, url, contact, product, prize, prizeMode, prizeSecret} | {action:"pay", code, method} | {action:"check", code}.
// "check" looks for the exact USDT amount on-chain and activates the slot by itself; it also returns the slot status and, for contests, the winners.
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const isCheck = b?.action === "check";
  if (isRateLimited(`ksp${isCheck ? "c" : ""}:${requestIp(req)}`, isCheck ? 40 : 10, 600_000)) return NextResponse.json({ ok: false, error: "طلبات كثيرة. حاول بعد دقائق." }, { status: 429 });
  let r: { ok: boolean; error?: string; [k: string]: unknown };
  if (isCheck) {
    const code = String(b.code || "").toUpperCase();
    const c = await checkSponsorUsdt(code).catch(() => ({ paid: false, status: null }));
    const s = await sponsorByCode(code).catch(() => null);
    if (!s) r = { ok: false, error: "الكود غير موجود." };
    else {
      const winners = s.product === "contest" ? (await sponsorPrizes(code).catch(() => [])).map((w) => ({ rank: w.rank, name: w.user_name, points: w.points, status: w.status })) : [];
      r = { ok: true, paid: c.paid, status: s.status, starts_at: s.starts_at, ends_at: s.ends_at, settled: !!s.settled_at, winners };
    }
  } else if (b?.action === "pay") {
    const m = ["stars", "nowpayments", "usdt"].includes(b.method) ? b.method : "usdt";
    r = await paySponsor(String(b.code || "").toUpperCase(), m).catch(() => ({ ok: false, error: "تعذّر إنشاء الدفع." }));
  } else {
    r = await createSponsorOrder({ name: String(b.name || ""), url: String(b.url || ""), contact: String(b.contact || ""), product: String(b.product || "khatma"), prize: String(b.prize || ""), prizeMode: String(b.prizeMode || ""), prizeSecret: String(b.prizeSecret || "") }).catch(() => ({ ok: false, error: "تعذّر الحفظ." }));
  }
  return NextResponse.json(r, { status: r.ok ? 200 : 400 });
}
