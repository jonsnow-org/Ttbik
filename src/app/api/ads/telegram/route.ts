import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { activateAd, findAdmenBot } from "@/lib/siteAds";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = await req.json().catch(() => null);
  const callback = update?.callback_query;
  const bot = await findAdmenBot();
  if (!bot) return NextResponse.json({ ok: true });

  const answer = async (id: string, text: string) => {
    await fetch(`https://api.telegram.org/bot${bot.token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: id, text }),
    });
  };

  if (!callback) {
    const chatId = update?.message?.chat?.id;
    if (chatId) {
      await fetch(`https://api.telegram.org/bot${bot.token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: "هذا بوت موافقة إعلانات الموقع. تصل الطلبات هنا بعد الدفع." }),
      });
    }
    return NextResponse.json({ ok: true });
  }

  const [action, code] = String(callback.data || "").split(":");
  if (!code || !["approve", "reject"].includes(action)) {
    await answer(callback.id, "أمر غير معروف");
    return NextResponse.json({ ok: true });
  }
  if (action === "reject") {
    await prisma.siteBannerAd.update({
      where: { reservationCode: code },
      data: { adStatus: "REJECTED", paymentStatus: "REFUND_REVIEW" },
    }).catch(() => null);
    await answer(callback.id, "رُفض الإعلان");
    return NextResponse.json({ ok: true });
  }
  await prisma.siteBannerAd.update({
    where: { reservationCode: code },
    data: { paymentStatus: "PAID" },
  }).catch(() => null);
  const ad = await activateAd(code);
  await answer(callback.id, ad?.adStatus === "ACTIVE" ? "تم التفعيل" : "لم يُفعّل");
  return NextResponse.json({ ok: true });
}
