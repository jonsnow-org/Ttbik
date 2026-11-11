import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { activateAd, adStars, bannerBalance, findSiteBot, markSiteAdPaid, SITE_AD_STARS_PREFIX, siteAdStarsEnabled, siteBotUsername } from "@/lib/siteAds";
import { adReportUrl } from "@/lib/adStats";
import { gateUrl } from "@/lib/hostingOps";
import { CHANNEL_STARS_PREFIX, dealByCode, markDealPaid } from "@/lib/channels/exchange";
import { assetSalePaymentIsAvailable } from "@/lib/channels/assetMarket";
import { SPONSOR_STARS_PREFIX, markSponsorPaid, sponsorByCode } from "@/lib/khatma/khatma";
import { REMIT_STARS_PREFIX, linkCompanyChat, listingByCode, markListingPaid, reviewListing } from "@/lib/remit/listings";
import { parseRefCommand, runRefCommand } from "@/lib/remit/refLinks";
import { officeCallback, officeStart, officeText, OFFICE_BUTTON } from "@/lib/remit/office";
import { BOT_PAID_USD, BOTBUY_STARS_PREFIX, GETBOT_BUTTON, botOrder, codeMessage, manualCode, markBotOrderPaid, parseCodeCommand } from "@/lib/botSales";
import { BOT_SALE_CALLBACK, handleBotSaleCallback, type Tg } from "@/lib/botSalesChat";
import { ownerBotGetbotLink } from "@/lib/builderOwnerBot";
import { SERVICES_BUTTON, SERVICES_TEXT, isServicesRequest, siteBotServicesKeyboard } from "@/lib/servicesInTelegram";

const SITE = gateUrl().replace(/\/$/, ""); // gate address: fails over to the standby hosts automatically
// The site bot (بوت الموقع), webhook set by bindSiteBot. A standalone bot: not part of the ads & earn builder (no Bot-table row, no AD_BOT role).
const KEYBOARD = { keyboard: [[{ text: OFFICE_BUTTON }], [{ text: "الرصيد" }, { text: "المحفظة" }], [{ text: "شراء" }, { text: "الموقع", web_app: { url: SITE } }], [{ text: SERVICES_BUTTON }]], resize_keyboard: true };
const HELP_TEXT = `بوت المنصة: 💸 حوالات USDT، الرصيد، المحفظة، الشراء، زر الموقع، و«${SERVICES_BUTTON}».`;

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (expected && secret !== expected) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = await req.json().catch(() => null);
  const callback = update?.callback_query;
  const bot = await findSiteBot();
  if (!bot) return NextResponse.json({ ok: true });

  const send = async (chatId: string | number, text: string) => {
    await fetch(`https://api.telegram.org/bot${bot.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, reply_markup: KEYBOARD }),
    });
  };
  const tg: Tg = (method, body) => fetch(`https://api.telegram.org/bot${bot.token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
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
      if (deal && ok && deal.kind === "ASSET_SALE") ok = String(pcq.from?.id || "") === String(deal.advertiser_tg_id || "") && await assetSalePaymentIsAvailable(deal.code);
    } else if (payload.startsWith(SPONSOR_STARS_PREFIX) && siteAdStarsEnabled() && pcq.currency === "XTR") {
      const sp = await sponsorByCode(payload.slice(SPONSOR_STARS_PREFIX.length)).catch(() => null);
      ok = !!sp && sp.status === "PENDING_PAYMENT" && Number(pcq.total_amount) >= adStars(sp.price);
    } else if (payload.startsWith(BOTBUY_STARS_PREFIX) && siteAdStarsEnabled() && pcq.currency === "XTR") {
      const o = await botOrder(payload.slice(BOTBUY_STARS_PREFIX.length));
      ok = !!o && o.status === "PENDING" && o.transferReference === "auto" && Number(pcq.total_amount) >= adStars(BOT_PAID_USD);
    } else if (payload.startsWith(REMIT_STARS_PREFIX) && siteAdStarsEnabled() && pcq.currency === "XTR") {
      const l = await listingByCode(payload.slice(REMIT_STARS_PREFIX.length)).catch(() => null);
      ok = !!l && ["APPROVED", "ACTIVE", "EXPIRED"].includes(l.status) && Number(pcq.total_amount) >= adStars(l.price);
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
        await send(update.message.chat.id, `✅ وصل الدفع (${sp.total_amount} ⭐). رعايتك (${code}) من ${fresh?.starts_at?.toISOString().slice(0, 10) || "اليوم"} إلى ${fresh?.ends_at?.toISOString().slice(0, 10) || ""}.`).catch(() => null);
      }
    }
    return NextResponse.json({ ok: true });
  }
  // 🤖 builder activation code paid in Stars: the code goes out at once
  if (sp && String(sp.invoice_payload || "").startsWith(BOTBUY_STARS_PREFIX)) {
    if (!siteAdStarsEnabled() || sp.currency !== "XTR" || Number(sp.total_amount) < adStars(BOT_PAID_USD)) return NextResponse.json({ ok: true });
    const r = await markBotOrderPaid(String(sp.invoice_payload).slice(BOTBUY_STARS_PREFIX.length), `Stars ${String(sp.telegram_payment_charge_id || "").slice(0, 60)}`).catch(() => ({ first: false, code: null, buyerId: null }));
    if (r.first && r.code && r.buyerId) await send(update.message.chat.id, codeMessage(r.code, r.buyerId, SITE, false)).catch(() => null);
    return NextResponse.json({ ok: true });
  }
  // 🏦 remittance listing paid in Stars: live at once (src/lib/remit/listings.ts)
  if (sp && String(sp.invoice_payload || "").startsWith(REMIT_STARS_PREFIX)) {
    if (!siteAdStarsEnabled() || sp.currency !== "XTR") return NextResponse.json({ ok: true });
    const code = String(sp.invoice_payload).slice(REMIT_STARS_PREFIX.length);
    const l = await listingByCode(code).catch(() => null);
    if (l && Number(sp.total_amount) >= adStars(l.price)) {
      const r = await markListingPaid(code, `Stars ${String(sp.telegram_payment_charge_id || "").slice(0, 60)}`).catch(() => ({ ok: false, first: false }));
      if (r.first) await send(update.message.chat.id, `✅ وصل الدفع (${sp.total_amount} ⭐). «${l.name}» ظاهر الآن في صفحة الحوالات.`).catch(() => null);
    }
    return NextResponse.json({ ok: true });
  }
  if (sp && String(sp.invoice_payload || "").startsWith(CHANNEL_STARS_PREFIX)) {
    if (!siteAdStarsEnabled() || sp.currency !== "XTR") return NextResponse.json({ ok: true });
    const code = String(sp.invoice_payload).slice(CHANNEL_STARS_PREFIX.length);
    const deal = await dealByCode(code).catch(() => null);
    if (deal && Number(sp.total_amount) >= adStars(deal.price)) {
      const payerTelegramId = String(update.message.from?.id || "");
      const r = await markDealPaid(code, `Stars ${sp.total_amount}⭐ ${String(sp.telegram_payment_charge_id || "").slice(0, 24)}`, undefined, String(sp.telegram_payment_charge_id || "").slice(0, 160), deal.kind === "ASSET_SALE" ? payerTelegramId : undefined);
      const msg = deal.kind === "BADGE"
        ? `✅ وصل الدفع (${sp.total_amount} ⭐). شارة ☑️ لقناة @${deal.channel} مفعّلة لسنة.`
        : deal.kind === "ASSET_SALE"
          ? `✅ وصل دفع صفقة الأصل ${code} (${sp.total_amount} ⭐). ابدأوا خطوات نقل الملكية من سوق الأصول داخل التطبيق. لن يُصرف المبلغ قبل التحقق من أن حساب المشتري أصبح المالك.`
          : `✅ وصل الدفع (${sp.total_amount} ⭐) لطلب ${code}. المبلغ محفوظ لدى المنصة حتى يُنشر إعلانك في @${deal.channel} ونتحقق منه.\nالمتابعة: ${SITE}/channels/deal/${code}`;
      if (r.ok) await send(update.message.chat.id,
        deal.kind === "ASSET_SALE" && r.assetSaleAccepted === false
          ? `⚠️ وصل دفع مرتبط بالصفقة ${code}، لكنه لا يطابق شروط الحجز أو حساب المشتري المسجل. لم تُعتمد الصفقة ولم يبدأ التسليم؛ تراجع الإدارة الاسترداد. لا تنقلوا الأصل.`
          : msg
      ).catch(() => null);
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

  const isOwner = (id: unknown) => !!process.env.SUPER_ADMIN_TELEGRAM_ID && String(id ?? "") === String(process.env.SUPER_ADMIN_TELEGRAM_ID);
  if (!callback) {
    const text = String(update?.message?.text || "");
    const chatId = update?.message?.chat?.id;
    // 🏦 a transfer company links its chat for approval/payment/renewal messages: /start rmt_<code>_<key>
    const startPayload = /^\/start\s+(\S+)/.exec(text)?.[1] || "";
    // 💸 the remittance office (src/lib/remit/office.ts): its button, a recipient's pay_<address> link, and the steps typed in the chat
    const office = { token: bot.token, site: SITE, botUsername: await siteBotUsername().catch(() => "") };
    if (chatId && startPayload.startsWith("pay_") && (await officeStart(office, String(chatId), startPayload).catch(() => false))) return NextResponse.json({ ok: true });
    // «احصل على بوت مشابه» is not offered here (owner, 2026-11-10): it belongs to the ads & earn builder bots. An old link or a typed
    // /getbot is pointed at the builder's owner bot (src/lib/builderOwnerBot.ts), where the checkout runs.
    if (chatId && (text === GETBOT_BUTTON || startPayload === "getbot" || /^\/getbot(@\w+)?$/i.test(text))) {
      const link = await ownerBotGetbotLink().catch(() => null);
      await fetch(`https://api.telegram.org/bot${bot.token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: link ? "🤖 إنشاء بوت إعلانات وربح خاص بك يتم من بوت المنصة:" : HELP_TEXT, reply_markup: link ? { inline_keyboard: [[{ text: "🤖 افتح البوت", url: link }]] } : KEYBOARD }),
      }).catch(() => null);
      return NextResponse.json({ ok: true });
    }
    const codeCmd = parseCodeCommand(text);
    if (chatId && codeCmd && isOwner(update?.message?.from?.id)) {
      const c = await manualCode(codeCmd.buyerId, codeCmd.free).catch(() => null);
      if (c) await send(codeCmd.buyerId, codeMessage(c, codeCmd.buyerId, SITE, codeCmd.free)).catch(() => null);
      await send(chatId, c ? `✅ كود ${codeCmd.free ? "مجاني" : "مدفوع"} لـ ${codeCmd.buyerId}: ${c}\n(أُرسل له إن كان قد بدأ المحادثة مع البوت)` : "تعذّر إنشاء الكود.");
      return NextResponse.json({ ok: true });
    }
    if (chatId && startPayload.startsWith("rmt_")) {
      const reply = await linkCompanyChat(startPayload, String(chatId)).catch(() => "تعذّر الربط الآن.");
      if (reply) await send(chatId, reply);
      return NextResponse.json({ ok: true });
    }
    // 🔗 owner only: referral links for /remit without a redeploy (/ref, /ref KEY https://…, /ref KEY off)
    const refCmd = parseRefCommand(text);
    if (chatId && refCmd && isOwner(update?.message?.from?.id)) {
      await send(chatId, await runRefCommand(refCmd).catch(() => "تعذّر الحفظ الآن."));
      return NextResponse.json({ ok: true });
    }
    // 🧭 the platform's service pages as Mini App buttons (src/lib/servicesInTelegram.ts); /start shows them too.
    // Before the remittance office's typed steps, so the button never gets read as an amount or address.
    if (chatId && (isServicesRequest(text) || /^\/start(@\w+)?$/i.test(text.trim()))) {
      if (!isServicesRequest(text)) await send(chatId, HELP_TEXT);
      await fetch(`https://api.telegram.org/bot${bot.token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: SERVICES_TEXT, reply_markup: siteBotServicesKeyboard(SITE) }),
      }).catch(() => null);
      return NextResponse.json({ ok: true });
    }
    if (chatId && !text.startsWith("/ref") && (await officeText(office, String(chatId), text).catch(() => false))) return NextResponse.json({ ok: true });
    if (chatId && (text === "الرصيد" || text.startsWith("/balance"))) {
      const balance = await bannerBalance();
      await send(chatId, `رصيد البنر: ${balance.total}$\nعدد المدفوع: ${balance.count}\nالنشط الآن: ${balance.active}\nرصيد البوت: ${balance.botBalance}$`);
    } else if (chatId) {
      await send(chatId, text === "المحفظة" ? "المحفظة تُفتح من التطبيق المصغر." : text === "شراء" ? "الشراء يتم داخل التطبيق المصغر." : HELP_TEXT);
    }
    return NextResponse.json({ ok: true });
  }

  if (callback.data === "balance") {
    const balance = await bannerBalance();
    await answer(callback.id, `${balance.total}$`);
    await send(callback.message?.chat?.id, `رصيد البنر: ${balance.total}$`);
    return NextResponse.json({ ok: true });
  }

  // 🤖 orders started here before the button moved to the builder bots: their plan/payment buttons still work (src/lib/botSalesChat.ts)
  if (BOT_SALE_CALLBACK.test(String(callback.data || ""))) {
    await answer(callback.id, "");
    const u = await siteBotUsername().catch(() => "");
    await handleBotSaleCallback(tg, callback.message?.chat?.id, String(callback.from?.id ?? ""), String(callback.data), { site: SITE, stars: true, returnUrl: u ? `https://t.me/${u}` : SITE, replyMarkup: KEYBOARD });
    return NextResponse.json({ ok: true });
  }
  // 💸 remittance office buttons: open to every user (each action is scoped to the user's own chat)
  if (String(callback.data || "").startsWith("ro:")) {
    await answer(callback.id, "");
    const chat = callback.message?.chat?.id;
    if (chat) await officeCallback({ token: bot.token, site: SITE, botUsername: await siteBotUsername().catch(() => "") }, String(chat), String(callback.data)).catch(() => null);
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
  // 🏦 remittance listing review: one tap (src/lib/remit/listings.ts)
  const rmt = /^rmt_(ok|no):(RMT-[0-9A-F]{8})$/.exec(String(callback.data || ""));
  if (rmt) {
    const r = await reviewListing(rmt[2], rmt[1] === "ok").catch(() => ({ ok: false, text: "تعذّر" }));
    await answer(callback.id, r.text);
    if (r.ok && callback.message?.chat?.id) await send(callback.message.chat.id, `${rmt[1] === "ok" ? "✅" : "❌"} ${rmt[2]}: ${r.text}`).catch(() => null);
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
