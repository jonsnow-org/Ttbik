import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { activateAd, bannerBalance, findAdmenBot } from "@/lib/siteAds";

const KEYBOARD = { keyboard: [[{ text: "الرصيد" }]], resize_keyboard: true };

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = await req.json().catch(() => null);
  const callback = update?.callback_query;
  const bot = await findAdmenBot();
  if (!bot) return NextResponse.json({ ok: true });

  const send = async (chatId: string | number, text: string) => {
    await fetch(`https://api.telegram.org/bot${bot.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup: KEYBOARD }),
    });
  };
  const answer = async (id: string, text: string) => {
    await fetch(`https://api.telegram.org/bot${bot.token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callback_query_id: id, text }),
    });
  };

  if (!callback) {
    const text = String(update?.message?.text || "");
    const chatId = update?.message?.chat?.id;
    if (chatId && (text === "الرصيد" || text.startsWith("/balance"))) {
      const balance = await bannerBalance();
      await send(chatId, `رصيد البنر: ${balance.total}$\nعدد المدفوع: ${balance.count}\nالنشط الآن: ${balance.active}\nرصيد البوت: ${balance.botBalance}$`);
    } else if (chatId) {
      await send(chatId, "بوت موافقة إعلانات الموقع. زر الرصيد يعرض حصيلة البنر المدفوعة.");
    }
    return NextResponse.json({ ok: true });
  }

  if (callback.data === "balance") {
    const balance = await bannerBalance();
    await answer(callback.id, `${balance.total}$`);
    await send(callback.message?.chat?.id, `رصيد البنر: ${balance.total}$`);
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
