// The Telegram side of paying for an Athar token with Stars (see atharStars.ts). Only the Athar bot uses this, only when ATHAR_ENABLE_STARS=1.
// Steps: /stars -> the date (reply) -> the kind (buttons) -> the address that receives the token (reply) -> the Stars invoice -> paid -> queue.
import { InlineKeyboard, type Bot as TelegramBot } from "grammy";
import { sendStarsInvoice } from "@/lib/starsPayment";
import { ATHAR_SITE } from "@/lib/atharMirror";
import { TIERS, createOrder, dateText, onSuccessfulPayment, parseDateIndex, starsEnabled, starsPrices, type Order, type Tier } from "@/lib/atharStars";

type L = "en" | "ar" | "ru" | "tr" | "fa";
const KIND: Record<Tier, { en: string; ar: string }> = { normal: { en: "Normal", ar: "عادي" }, silver: { en: "Silver", ar: "فضي" }, gold: { en: "Gold", ar: "ذهبي" } };
const TX: Record<"en" | "ar", Record<string, string>> = {
  en: {
    label: "⭐ Gift with Stars",
    askDate: "⭐ Choose the date of your token (any day from 1950 to 2049), for example 14/3/2003. Reply to this message.",
    badDate: "I could not read that date. Please reply with day/month/year, for example 14/3/2003.",
    pick: "Which kind for {d}?",
    askAddr: "Send the TON wallet address that will receive the token for {d} ({k}, {s} ⭐). Reply to this message.\nref: {k0}·{i}",
    badAddr: "That does not look like a TON address. Please send it again.",
    taken: "This kind of that date is already taken. Try another date or kind.",
    busy: "Someone is paying for this date right now. Try again in a few minutes.",
    unknown: "I cannot check the chain right now. Please try again in a minute.",
    off: "Paying with Stars is not available now.",
    invTitle: "Athar · {d} · {k}",
    invDesc: "A token for {d} on TON, gifted to your wallet. A keepsake, not an investment. Minted by hand, usually within a day.",
    paid: "✅ Payment received. Your token for {d} will be minted to your wallet soon; I will message you here when it is done. If it cannot be minted, your Stars are returned automatically.",
    late: "Your payment arrived after the order expired. Your Stars are being returned.",
    minted: "🎉 Your Athar token for {d} was minted. Open it in the app:",
    refunded: "↩️ Your Stars for {d} were returned. You can try again any time.",
  },
  ar: {
    label: "⭐ هدية بالنجوم",
    askDate: "⭐ اختر تاريخ رمزك (أي يوم من 1950 إلى 2049) مثل 14/3/2003. ردّ على هذه الرسالة.",
    badDate: "لم أفهم التاريخ. أرسل يوم/شهر/سنة مثل 14/3/2003.",
    pick: "أي صنف للتاريخ {d}؟",
    askAddr: "أرسل عنوان محفظة TON التي سيصلها رمز {d} ({k}، {s} ⭐). ردّ على هذه الرسالة.\nref: {k0}·{i}",
    badAddr: "هذا لا يشبه عنوان TON. أرسله من جديد.",
    taken: "هذا الصنف من هذا التاريخ مأخوذ. جرّب تاريخاً أو صنفاً آخر.",
    busy: "هناك من يدفع لهذا التاريخ الآن. جرّب بعد دقائق.",
    unknown: "لا أستطيع فحص السلسلة الآن. جرّب بعد دقيقة.",
    off: "الدفع بالنجوم غير متاح الآن.",
    invTitle: "أثر · {d} · {k}",
    invDesc: "رمز لتاريخ {d} على TON يُهدى إلى محفظتك. ذكرى لا استثمار. يُسك يدوياً وغالباً خلال يوم.",
    paid: "✅ وصل الدفع. سيُسك رمز {d} إلى محفظتك قريباً وسأراسلك هنا عند الانتهاء. وإن تعذّر سكّه تعود نجومك تلقائياً.",
    late: "وصل دفعك بعد انتهاء الطلب. نجومك تعود إليك الآن.",
    minted: "🎉 تم سكّ رمز أثر لتاريخ {d}. افتحه في التطبيق:",
    refunded: "↩️ عادت نجومك الخاصة بتاريخ {d}. يمكنك المحاولة في أي وقت.",
  },
};
const tx = (lang: string, key: string, v: Record<string, string | number> = {}) =>
  (TX[lang === "ar" ? "ar" : "en"][key] ?? TX.en[key]).replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ""));
const kindName = (lang: string, t: Tier) => (lang === "ar" ? KIND[t].ar : KIND[t].en);

/** The menu button text; the menu shows it only while the flag is on. */
export const starsLabels = () => [TX.en.label, TX.ar.label];
export const starsButton = (lang: L) => tx(lang, "label");

const isAskDate = (t?: string) => !!t && (t === TX.en.askDate || t === TX.ar.askDate);
const askAddrRef = (t?: string) => (t ? /ref:\s*(normal|silver|gold)·(\d{1,5})\s*$/.exec(t) : null);
const tierFromRef = (s: string) => TIERS.find((x) => x === s);

/** True when the update was a Stars step and has been answered. Called first in the text handler; does nothing when the flag is off. */
export async function handleStarsMessage(bot: TelegramBot, botId: string, msg: any, lang: L): Promise<boolean> {
  if (!starsEnabled()) return false;
  const chatId = msg.chat.id, text = String(msg.text || "").trim(), from = String(msg.from?.id || "");
  const replyTo = msg.reply_to_message?.text as string | undefined;
  const ask = /^\/stars(?:@\w+)?$/i.test(text) || starsLabels().includes(text);
  if (ask) {
    await bot.api.sendMessage(chatId, tx(lang, "askDate"), { reply_markup: { force_reply: true, input_field_placeholder: "14/3/2003" } });
    return true;
  }
  if (isAskDate(replyTo)) {
    const idx = parseDateIndex(text);
    if (idx === null) { await bot.api.sendMessage(chatId, tx(lang, "badDate"), { reply_markup: { force_reply: true, input_field_placeholder: "14/3/2003" } }); return true; }
    const price = starsPrices(), kb = new InlineKeyboard();
    for (const t of TIERS) kb.text(`${kindName(lang, t)} · ${price[t]} ⭐`, `as:${t}:${idx}`).row();
    await bot.api.sendMessage(chatId, tx(lang, "pick", { d: dateText(idx) }), { reply_markup: kb });
    return true;
  }
  const ref = askAddrRef(replyTo);
  if (ref && from) {
    const tier = tierFromRef(ref[1]), idx = Number(ref[2]);
    if (!tier) return false;
    const res = await createOrder(botId, from, idx, tier, text, ATHAR_SITE);
    if (!res.ok) {
      const key = res.reason === "address" ? "badAddr" : res.reason === "date" ? "badDate" : res.reason;
      await bot.api.sendMessage(chatId, tx(lang, key), res.reason === "address" ? { reply_markup: { force_reply: true } } : undefined);
      return true;
    }
    const d = dateText(idx);
    const ok = await sendStarsInvoice(bot, chatId, { title: tx(lang, "invTitle", { d, k: kindName(lang, tier) }), description: tx(lang, "invDesc", { d }), payload: res.order.id, stars: res.order.stars_amount });
    if (!ok) await bot.api.sendMessage(chatId, tx(lang, "unknown"));
    return true;
  }
  return false;
}

/** Callback buttons "as:<tier>:<date>": ask for the receiving address. */
export async function handleStarsCallback(bot: TelegramBot, chatId: number, data: string, lang: L): Promise<boolean> {
  const m = /^as:(normal|silver|gold):(\d{1,5})$/.exec(data);
  if (!m) return false;
  if (!starsEnabled()) { await bot.api.sendMessage(chatId, tx(lang, "off")); return true; }
  const tier = m[1] as Tier, idx = Number(m[2]);
  await bot.api.sendMessage(chatId, tx(lang, "askAddr", { d: dateText(idx), k: kindName(lang, tier), s: starsPrices()[tier], k0: tier, i: idx }), { reply_markup: { force_reply: true, input_field_placeholder: "UQ..." } });
  return true;
}

/** The message with successful_payment: records it and tells the person. Returns true when it was a Stars payment of this bot. */
export async function handleStarsPayment(bot: TelegramBot, msg: any, lang: L): Promise<boolean> {
  const p = msg.successful_payment;
  if (!p || p.currency !== "XTR") return false;
  const r = await onSuccessfulPayment(p);
  const chatId = msg.chat.id;
  if (r.kind === "paid") await bot.api.sendMessage(chatId, tx(lang, "paid", { d: dateText(r.order.date_index) })).catch(() => null);
  else if (r.kind === "late") await bot.api.sendMessage(chatId, tx(lang, "late")).catch(() => null);
  return true;
}

/** Messages sent from the scheduled sweep once an order is minted or refunded. */
export async function notifyOrder(bot: TelegramBot, o: Order, what: "minted" | "refunded", lang: L, tokenUrl: string): Promise<void> {
  const d = dateText(o.date_index);
  const kb = what === "minted" ? new InlineKeyboard().url(`Athar · ${d}`, tokenUrl) : undefined;
  await bot.api.sendMessage(Number(o.tg_user_id), tx(lang, what, { d }), kb ? { reply_markup: kb } : undefined).catch(() => null);
}
