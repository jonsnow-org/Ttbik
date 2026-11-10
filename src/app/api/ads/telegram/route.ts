import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { activateAd, adStars, bannerBalance, findAdmenBot, markSiteAdPaid, SITE_AD_STARS_PREFIX, siteAdStarsEnabled } from "@/lib/siteAds";
import { adReportUrl } from "@/lib/adStats";
import { gateUrl } from "@/lib/hostingOps";
import { CHANNEL_STARS_PREFIX, dealByCode, markDealPaid } from "@/lib/channels/exchange";
import { SPONSOR_STARS_PREFIX, markSponsorPaid, sponsorByCode } from "@/lib/khatma/khatma";

const SITE = gateUrl().replace(/\/$/, ""); // gate address: fails over to the standby hosts automatically
const KEYBOARD = { keyboard: [[{ text: "الرصيد" }, { text: "المحفظة" }], [{ text: "شراء" }, { text: "الموقع", web_app: { url: SITE } }]], resize_keyboard: true };

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expected && secret !== expected) {
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

  // ⭐ Stars checkout for site ads: approve only a live, unpaid order at its full price…
  const pcq = update?.pre_checkout_query;
  if (pcq) {
    const payload = String(pcq.invoice_payload || "");
    let ok = false;
    if (payload.startsWith(SITE_AD_STARS_PREFIX) && siteAdStarsEnabled() && pcq.currency === "XTR") {
      const ad = await prisma.siteBannerAd.findUnique({ where: { reservationCode: payload.slice(SITE_AD_STARS_PREFIX.length) } }).catch(() => null);
      ok = !!ad && ad.paymentStatus !== "PAID" && ad.adStatus !== "REJECTED" && Number(pcq.total_amount) >= adStars(ad.totalPrice);
    } else if (payload.startsWith(CHANNEL_STARS_PREFIX) && siteAdStarsEnabled() && pcq.currency === "XTR") {
      const deal = await dealByCode(payload.slice(CHANNEL_STARS_PREFIX.length)).catch(() => null);
      ok = !!deal && deal.status === "PENDING_PAYMENT" && Number(pcq.total_amount) >= adStars(deal.price);
    } else if (payload.startsWith(SPONSOR_STARS_PREFIX) && siteAdStarsEnabled() && pcq.currency === "XTR") {
      const sp = await sponsorByCode(payload.slice(SPONSOR_STARS_PREFIX.length)).catch(() => null);
      ok = !!sp && sp.status === "PENDING_PAYMENT" && Number(pcq.total_amount) >= adStars(sp.price);
    }
    await fetch(`https://api.telegram.org/bot${bot.token}/answerPreCheckoutQuery`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(ok ? { pre_checkout_query_id: pcq.id, ok: true } : { pre_checkout_query_id: pcq.id, ok: false, error_message: "الطلب غير متاح للدفع (مدفوع مسبقاً أو غير موجود)." }),
    }).catch(() => null);
    return NextResponse.json({ ok: true });
  }
  // …and credit it when Telegram confirms (only on a webhook verified by the secret token).
  const sp = update?.message?.successful_payment;
  if (sp && String(sp.invoice_payload || "").startsWith(SPONSOR_STARS_PREFIX)) {
    if (!siteAdStarsEnabled() || sp.currency !== "XTR") return NextResponse.json({ ok: true });
    const code = String(sp.invoice_payload).slice(SPONSOR_STARS_PREFIX.length);
    const row = await sponsorByCode(code).catch(() => null);
    if (row && Number(sp.total_amount) >= adStars(row.price)) {
      const r = await markSponsorPaid(code, `Stars ${sp.total_amount}⭐ ${String(sp.telegram_payment_charge_id || "").slice(0, 24)}`);
      if (r.first) {
        const fresh = await sponsorByCode(code).catch(() => null);
        await send(update.message.chat.id, `✅ وصل الدفع (${sp.total_amount} ⭐). رعايتك للختمات (${code}) من ${fresh?.starts_at?.toISOString().slice(0, 10) || "اليوم"} إلى ${fresh?.ends_at?.toISOString().slice(0, 10) || ""}.`).catch(() => null);
      }
    }
    return NextResponse.json({ ok: true });
  }
  if (sp && String(sp.invoice_payload || "").startsWith(CHANNEL_STARS_PREFIX)) {
    if (!siteAdStarsEnabled() || sp.currency !== "XTR") return NextResponse.json({ ok: true });
    const code = String(sp.invoice_payload).slice(CHANNEL_STARS_PREFIX.length);
    const deal = await dealByCode(code).catch(() => null);
    if (deal && Number(sp.total_amount) >= adStars(deal.price)) {
      const r = await markDealPaid(code, `Stars ${sp.total_amount}⭐ ${String(sp.telegram_payment_charge_id || "").slice(0, 24)}`);
      const msg = deal.kind === "BADGE"
        ? `✅ وصل الدفع (${sp.total_amount} ⭐). شارة ☑️ لقناة @${deal.channel} مفعّلة لسنة.`
        : `✅ وصل الدفع (${sp.total_amount} ⭐) لطلب ${code}. المبلغ محفوظ لدى المنصة حتى يُنشر إعلانك في @${deal.channel} ونتحقق منه.\nالمتابعة: ${SITE}/channels/deal/${code}`;
      if (r.ok) await send(update.message.chat.id, msg).catch(() => null);
    }
    return NextResponse.json({ ok: true });
  }
  if (sp && String(sp.invoice_payload || "").startsWith(SITE_AD_STARS_PREFIX)) {
    if (!siteAdStarsEnabled() || sp.currency !== "XTR") return NextResponse.json({ ok: true });
    const code = String(sp.invoice_payload).slice(SITE_AD_STARS_PREFIX.length);
    const ad = await prisma.siteBannerAd.findUnique({ where: { reservationCode: code } }).catch(() => null);
    if (ad && Number(sp.total_amount) >= adStars(ad.totalPrice)) {
      const r = await markSiteAdPaid(code, `Stars ${sp.total_amount}⭐ ${String(sp.telegram_payment_charge_id || "").slice(0, 24)}`);
      const report = adReportUrl(code);
      await send(update.message.chat.id, `✅ وصل الدفع (${sp.total_amount} ⭐) للإعلان ${code}.${r.first ? " يُراجع الآن ثم يُفعَّل." : ""}${report ? `\n📊 تقرير المشاهدات والنقرات:\n${report}` : ""}`).catch(() => null);
    }
    return NextResponse.json({ ok: true });
  }

  if (!callback) {
    const text = String(update?.message?.text || "");
    const chatId = update?.message?.chat?.id;
    if (chatId && (text === "الرصيد" || text.startsWith("/balance"))) {
      const balance = await bannerBalance();
      await send(chatId, `رصيد البنر: ${balance.total}$\nعدد المدفوع: ${balance.count}\nالنشط الآن: ${balance.active}\nرصيد البوت: ${balance.botBalance}$`);
    } else if (chatId) {
      await send(chatId, text === "المحفظة" ? "المحفظة تُفتح من التطبيق المصغر." : text === "شراء" ? "الشراء يتم داخل التطبيق المصغر." : "بوت الموقع: الرصيد، المحفظة، الشراء، وزر الموقع.");
    }
    return NextResponse.json({ ok: true });
  }

  if (callback.data === "balance") {
    const balance = await bannerBalance();
    await answer(callback.id, `${balance.total}$`);
    await send(callback.message?.chat?.id, `رصيد البنر: ${balance.total}$`);
    return NextResponse.json({ ok: true });
  }

  // Approve/reject only from the admin chat the requests are sent to (notifyAdmin), never from any other user of the bot:
  // approving marks the ad PAID, so a crafted callback from a stranger must not activate a free ad.
  const adminChat = String(process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.SUPER_ADMIN_TELEGRAM_ID || "");
  const superAdmin = String(process.env.SUPER_ADMIN_TELEGRAM_ID || "");
  const fromOk = !!adminChat && (String(callback.message?.chat?.id ?? "") === adminChat || (!!superAdmin && String(callback.from?.id ?? "") === superAdmin));
  if (!fromOk) {
    await answer(callback.id, "غير مصرح");
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
  if (ad?.adStatus === "ACTIVE") {
    const report = adReportUrl(code);
    if (report && callback.message?.chat?.id) await send(callback.message.chat.id, `✅ ${code} نشط حتى ${ad.endsAt?.toISOString().slice(0, 10)}\n📊 رابط تقرير المعلن (أرسله له):\n${report}`).catch(() => null);
  }
  return NextResponse.json({ ok: true });
}
