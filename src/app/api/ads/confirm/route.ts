import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { actionUrl, notifyAdmin } from "@/lib/siteAds";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const code = String(body.code || "").trim().toUpperCase();
  const ad = await prisma.siteBannerAd.findUnique({ where: { reservationCode: code } });
  if (!ad) return NextResponse.json({ error: "الكود غير موجود." }, { status: 404 });
  if (ad.paymentStatus !== "PAID") {
    await prisma.siteBannerAd.update({
      where: { reservationCode: code },
      data: { adStatus: "PENDING_APPROVAL" },
    });
  }
  await notifyAdmin(
    `طلب بنر ${code}\nالعنوان: ${ad.altText}\nالرابط: ${ad.targetUrl}\nالمدة: ${ad.durationDays} يوم\nالسعر: ${ad.totalPrice}$\nالدفع: ${ad.paymentStatus}\nالبنر: ${ad.bannerUrl}`,
    actionUrl("approve", code),
    actionUrl("reject", code),
  );
  return NextResponse.json({ ok: true, status: ad.paymentStatus === "PAID" ? "بانتظار موافقة التلجرام" : "أُبلغ المدير. التفعيل بعد تأكيد الدفع." });
}
