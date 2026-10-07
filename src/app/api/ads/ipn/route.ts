import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyNowPaymentsSignature } from "@/lib/nowpaymentsSignature";
import { notifyAdmin } from "@/lib/siteAds";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-nowpayments-sig");
  if (!verifyNowPaymentsSignature(JSON.parse(raw), signature || "")) return NextResponse.json({ error: "bad sig" }, { status: 401 });
  const body = JSON.parse(raw);
  const code = String(body.order_id || "").toUpperCase();
  if (!code.startsWith("ADV-")) return NextResponse.json({ ok: true });
  if (String(body.payment_status) !== "finished") return NextResponse.json({ ok: true, ignored: body.payment_status });
  const ad = await prisma.siteBannerAd.update({
    where: { reservationCode: code },
    data: { paymentStatus: "PAID", adStatus: "PENDING_APPROVAL" },
  });
  await notifyAdmin(
    `دُفع بنر ${code}\n${ad.totalPrice}$ لمدة ${ad.durationDays} يوم\n${ad.targetUrl}`,
    code,
  );
  return NextResponse.json({ ok: true });
}
