// The chat side of «🤖 احصل على بوت مشابه» (plans → free code, or paid order → USDT / Stars / NOWPayments → code delivered on payment),
// shared by every bot that sells activation codes: the site bot (/api/ads/telegram) and the builder's owner bot (AD_BOT template,
// see builderOwnerBot.ts). Transport-agnostic: the caller passes a `tg(method, body)` bound to its own bot token.
import { BOT_PAID_USD, BOTBUY_STARS_PREFIX, PLANS_TEXT, botOrder, botOrderUsdtQuote, checkBotOrderUsdt, codeMessage, freeCode, paidOrder } from "@/lib/botSales";
import { adStars, siteAdStarsEnabled } from "@/lib/siteAds";
import { createInvoice, isNowPaymentsConfigured } from "@/lib/nowpayments";

export type Tg = (method: string, body: Record<string, unknown>) => Promise<unknown>;
export type SalesOpts = {
  site: string;
  /** Offer ⭐ Stars: only on a bot whose webhook confirms BOTBUY Stars payments (the site bot). */
  stars: boolean;
  /** Where NOWPayments sends the buyer back (the bot's t.me link); the site when unknown. */
  returnUrl: string;
  /** reply_markup for plain text replies (the site bot keeps its keyboard). */
  replyMarkup?: unknown;
};

export function isGetbotRequest(text: string, button: string): boolean {
  const t = String(text || "").trim();
  return t === button || /^\/start\s+getbot$/i.test(t) || /^\/getbot(@\w+)?$/i.test(t);
}

export async function sendPlans(tg: Tg, chatId: string | number): Promise<void> {
  await tg("sendMessage", { chat_id: chatId, text: PLANS_TEXT, reply_markup: { inline_keyboard: [[{ text: "🆓 مجاني", callback_data: "bs:free" }, { text: `💎 مدفوع ${BOT_PAID_USD}$`, callback_data: "bs:paid" }]] } }).catch(() => null);
}

export const BOT_SALE_CALLBACK = /^bs:(free|paid|usdt|np|st|chk)(?::([0-9a-f-]{36}))?$/;

/** Handles a `bs:*` button. Returns false when `data` is not one. Each order belongs to the user who taps. */
export async function handleBotSaleCallback(tg: Tg, chat: string | number, who: string, data: string, o: SalesOpts): Promise<boolean> {
  const bs = BOT_SALE_CALLBACK.exec(String(data || ""));
  if (!bs) return false;
  if (!chat || !who) return true;
  const send = (text: string) => tg("sendMessage", { chat_id: chat, text, ...(o.replyMarkup ? { reply_markup: o.replyMarkup } : {}) }).catch(() => null);
  const raw = (body: Record<string, unknown>, method = "sendMessage") => tg(method, { chat_id: chat, ...body }).catch(() => null);
  if (bs[1] === "free") {
    const r = await freeCode(who).catch(() => null);
    await send(r ? `${r.reused ? "لديك كود مجاني سابق:\n\n" : ""}${codeMessage(r.code, who, o.site, true)}` : "تعذّر إنشاء الكود الآن، حاول بعد قليل.");
    return true;
  }
  if (bs[1] === "paid") {
    const ord = await paidOrder(who).catch(() => null);
    if (!ord) { await send("تعذّر إنشاء الطلب الآن."); return true; }
    const rows: { text: string; callback_data: string }[][] = [[{ text: "💵 USDT (TRC20) مباشرة", callback_data: `bs:usdt:${ord.id}` }]];
    if (o.stars) rows.push([{ text: "⭐ نجوم تيليجرام", callback_data: `bs:st:${ord.id}` }]);
    if (isNowPaymentsConfigured()) rows.push([{ text: "💎 عملات رقمية أخرى", callback_data: `bs:np:${ord.id}` }]);
    await raw({ text: `💎 الخطة المدفوعة: ${BOT_PAID_USD}$ مرة واحدة. اختر طريقة الدفع، ويصلك الكود هنا تلقائياً بعد تأكيد الدفع:`, reply_markup: { inline_keyboard: rows } });
    return true;
  }
  const ord = bs[2] ? await botOrder(bs[2]) : null;
  if (!ord || ord.buyerId !== who) { await send("الطلب غير موجود."); return true; }
  if (ord.status !== "PENDING") { if (ord.code) await send(codeMessage(ord.code, who, o.site, false)); return true; }
  if (bs[1] === "usdt") {
    const q = await botOrderUsdtQuote(ord.id).catch(() => null);
    if (!q?.ok) { await send("تعذّر إنشاء طلب USDT الآن، اختر طريقة أخرى أو حاول بعد قليل."); return true; }
    await raw({ text: `💵 أرسل بالضبط ${q.amount} USDT على شبكة TRC20 إلى:\n${q.address}\n\nالمبلغ المميِّز يربط الدفع بطلبك تلقائياً (صالح ${q.expiresInMin} دقيقة). بعد الإرسال اضغط الزر:`, reply_markup: { inline_keyboard: [[{ text: "✅ أرسلت، تحقّق", callback_data: `bs:chk:${ord.id}` }]] } });
    return true;
  }
  if (bs[1] === "chk") {
    const r = await checkBotOrderUsdt(ord.id).catch(() => null);
    if (r?.first && r.code) await send(codeMessage(r.code, who, o.site, false));
    else await raw({ text: "لم يصل بعد. تأكيد الشبكة يأخذ دقيقة أو اثنتين؛ وسيصلك الكود هنا تلقائياً حتى لو لم تضغط.", reply_markup: { inline_keyboard: [[{ text: "🔄 تحقّق مرة أخرى", callback_data: `bs:chk:${ord.id}` }]] } });
    return true;
  }
  if (bs[1] === "st") {
    if (!o.stars || !siteAdStarsEnabled()) { await send("الدفع بالنجوم غير متاح الآن، اختر USDT."); return true; }
    await raw({ title: "كود تفعيل بوت", description: `كود تفعيل بوت إعلانات وأرباح، خطة مدفوعة (عمولتك 20%).`, payload: `${BOTBUY_STARS_PREFIX}${ord.id}`, currency: "XTR", prices: [{ label: "كود تفعيل", amount: adStars(BOT_PAID_USD) }] }, "sendInvoice");
    return true;
  }
  const inv = await createInvoice({ priceAmount: BOT_PAID_USD, orderId: `BOT-${ord.id}`, orderDescription: "Bot activation code", ipnCallbackUrl: `${o.site}/api/ads/ipn`, successUrl: o.returnUrl, cancelUrl: o.returnUrl }).catch(() => null);
  await send(inv?.ok && inv.invoiceUrl ? `💎 ادفع من هنا، ويصلك الكود تلقائياً بعد التأكيد:\n${inv.invoiceUrl}` : "تعذّر إنشاء الفاتورة الآن، اختر USDT.");
  return true;
}

/** Sends a minted code to the buyer: through the builder's owner bot first, then the site bot (whichever chat the buyer has opened). */
export async function deliverBotCode(buyerId: string, text: string): Promise<boolean> {
  const { ownerBot } = await import("@/lib/builderOwnerBot");
  const { findSiteBot } = await import("@/lib/siteAds");
  const tokens = [(await ownerBot().catch(() => null))?.token, (await findSiteBot().catch(() => null))?.token].filter((t): t is string => !!t);
  for (const token of tokens) {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: buyerId, text }) }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (data?.ok) return true;
  }
  return false;
}
