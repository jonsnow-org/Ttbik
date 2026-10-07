import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key") || "";
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.NOWPAYMENTS_IPN_SECRET || "";
  if (!secret || key !== secret) return new NextResponse("مرفوض", { status: 401 });
  const code = String(req.nextUrl.searchParams.get("code") || "").toUpperCase();
  await prisma.siteBannerAd.update({
    where: { reservationCode: code },
    data: { adStatus: "REJECTED", paymentStatus: "REFUND_REVIEW" },
  });
  return new NextResponse(`رُفض ${code}. أعد المبلغ يدوياً من لوحة الدفع إن وُجد.`);
}
