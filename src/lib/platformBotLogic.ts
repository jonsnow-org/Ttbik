// The bot of the coin platform (template ZNBT_PLATFORM_BOT): users get a welcome and one mini-app button; the owner gets the same plus a panel button and /platform. It is independent of the Athar and Zenobia bots:
// it only reads the platform's own state (znbtConfig, the coin index, the reports), so any bot row can be moved or replaced without touching it.
import { Bot as TelegramBot, InlineKeyboard } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { HOSTING } from "@/lib/hostingOps";
import { handlePlatformCallback, platformKeyboard, platformText } from "@/lib/hostingPanel";

export const PLATFORM_COMMANDS = [{ command: "start", description: "Open Palmyra Launch" }];

const HELP = "🪙 Palmyra Launch owner bot · بوت مالك تدمر لانش\n\n/referrals — invite rewards: log, payout wallet, on/off, pay, withdraw · سجل المكافآت والمحفظة والصرف\n/platform — open or close the platform, ZNBt status, reports\n/platform — فتح/إغلاق المنصة وحالة ZNBt والبلاغات\n\nOnly the owner can use this bot. · للمالك فقط.";

type Lang = "en" | "ar" | "ru";
const appUrl = (lang: Lang = "en") => `${HOSTING.gateUrl}/zenobia/coins.html${lang === "en" ? "" : `?lang=${lang}`}`;
// Users see English only; Arabic appears for the owner (under the English) and for anyone who taps the language button.
const WELCOME = {
  en: "🪙 Palmyra Launch\nLaunch and trade coins on TON, with fixed fees shown before you confirm.\nNothing here is financial advice or a promise of profit.",
  ar: "🪙 Palmyra Launch · تدمر لانش\nأطلق عملتك وتداولها على TON برسوم ثابتة تظهر قبل التأكيد.\nلا نصيحة مالية ولا وعد بربح.",
  ru: "🪙 Palmyra Launch\nЗапускайте и торгуйте монетами в сети TON: фиксированные комиссии видны до подтверждения.\nЭто не финансовая рекомендация и не обещание прибыли.",
};
const OPEN_LABEL: Record<Lang, string> = { en: "🪙 Open Palmyra Launch", ar: "🪙 افتح Palmyra Launch", ru: "🪙 Открыть Palmyra Launch" };
// the language button shows the NEXT language: English -> Russian -> Arabic -> English
const NEXT: Record<Lang, { label: string; data: string }> = { en: { label: "🌐 Русский", data: "pl:ru" }, ru: { label: "🌐 العربية", data: "pl:ar" }, ar: { label: "🌐 English", data: "pl:en" } };
/** Telegram's own language code decides the first language a user sees: Russian speakers get Russian, everyone else English. */
export const startLang = (code?: string): Lang => (/^ru\b/i.test(code || "") ? "ru" : "en");

/** The mini-app button (also the menu button next to the message box) and the language switch; the owner gets one more button, nobody else does. */
export const appKeyboard = (lang: Lang = "en", isOwner = false) => {
  const kb = new InlineKeyboard().webApp(OPEN_LABEL[lang], appUrl(lang));
  kb.row().text(NEXT[lang].label, NEXT[lang].data);
  if (isOwner) kb.row().text("⚙️ Owner panel · لوحة المالك", "zp:refresh");
  return kb;
};

export async function handlePlatformBotUpdate(bot: TelegramBot, botRow: BotRow, body: any): Promise<void> {
  const cq = body.callback_query;
  const msg = cq?.message ?? body.message;
  const chatId: number | undefined = msg?.chat?.id;
  const from = String((cq?.from ?? body.message?.from)?.id ?? "");
  if (!chatId || !from) return;
  const isOwner = from === botRow.ownerId;
  if (cq) {
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    const data = String(cq.data || "");
    if (isOwner && data.startsWith("zp:")) await handlePlatformCallback(bot, chatId, data, cq.message?.message_id);
    else if (data === "pl:ar" || data === "pl:en" || data === "pl:ru") {
      const l = data.slice(3) as Lang;
      await bot.api.editMessageText(chatId, cq.message.message_id, WELCOME[l], { reply_markup: appKeyboard(l, isOwner) }).catch(() => null);
    }
    return;
  }
  const text = String(body.message?.text || "").trim();
  if (/^\/start(@\w+)?(\s+\S+)?$/i.test(text)) {
    const ref = /^\/start(?:@\w+)?\s+ref_(\d{3,15})$/i.exec(text);
    if (ref && !isOwner) await import("@/lib/znbtEngage").then((m) => m.recordReferral(from, ref[1])).catch(() => null);   // invite counting only
    const first = startLang((body.message?.from as { language_code?: string } | undefined)?.language_code);
    await bot.api.setChatMenuButton({ chat_id: chatId, menu_button: { type: "web_app", text: "Palmyra Launch", web_app: { url: appUrl(isOwner ? "ar" : first) } } }).catch(() => null);
    await bot.api.sendMessage(chatId, isOwner ? `${WELCOME.en}\n\n${WELCOME.ar}` : WELCOME[first], { reply_markup: appKeyboard(isOwner ? "ar" : first, isOwner) });
  } else if (/^\/platform(@\w+)?$/i.test(text) && isOwner) {
    const p = await platformText();
    await bot.api.sendMessage(chatId, p.text, { reply_markup: platformKeyboard(p.open), link_preview_options: { is_disabled: true } });
  } else if (/^\/referrals(@\w+)?(\s|$)/i.test(text) && isOwner) {
    await handleReferralsCommand(bot, chatId, text);
  } else if (text.startsWith("/") && isOwner) {
    await bot.api.sendMessage(chatId, HELP);
  }
}

/** Owner-only /referrals: the invite-reward log and the manual controls of the payout wallet (lib/znbtPayout.ts). */
async function handleReferralsCommand(bot: TelegramBot, chatId: number, text: string): Promise<void> {
  const say = (m: string) => bot.api.sendMessage(chatId, m, { link_preview_options: { is_disabled: true } }).catch(() => null);
  const [, arg, rest] = text.trim().split(/\s+/);
  try {
    const P = await import("@/lib/znbtPayout");
    const a = (arg || "").toLowerCase();
    if (a === "on" || a === "off") { await P.setPayouts(a === "on"); await say(a === "on" ? "✅ Automatic payouts ON. Rewards due are paid from the payout wallet while it has funds." : "⛔ Automatic payouts OFF."); }
    else if (a === "pay") { const r = await P.runPayouts(true); const { fmtNano } = await import("@/lib/znbtRefs"); await say(`Paid ${r.sent} payout(s), ${fmtNano(r.total)} GRAM.${r.note ? "\n" + r.note : ""}`); }
    else if (a === "withdraw") {
      const { Address } = await import("@ton/core");
      try { Address.parse(rest || ""); } catch { await say("Usage: /referrals withdraw ADDRESS"); return; }
      await say((await P.withdrawAll(rest)) ? "✅ Sent everything in the payout wallet to " + rest : "⚠️ The withdrawal could not be confirmed: check the wallet on the explorer.");
    }
    else if (a === "resolve" && (rest === "sent" || rest === "failed")) await say(`Marked ${await P.resolveUnknown(rest === "sent")} unresolved payout(s) as ${rest}.`);
    else await say(await P.ownerLog());
  } catch (e: any) { await say("⚠️ " + String(e?.message || e).slice(0, 300)); }
}
