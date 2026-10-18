// The bot of the coin platform (template ZNBT_PLATFORM_BOT): users get a welcome and one mini-app button; the owner gets the same plus a panel button and /platform. It is independent of the Athar and Zenobia bots:
// it only reads the platform's own state (znbtConfig, the coin index, the reports), so any bot row can be moved or replaced without touching it.
import { Bot as TelegramBot, InlineKeyboard } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { HOSTING } from "@/lib/hostingOps";
import { handlePlatformCallback, platformKeyboard, platformText } from "@/lib/hostingPanel";

export const PLATFORM_COMMANDS = [{ command: "start", description: "Open Palmyra Launch" }];

const HELP = "🪙 Palmyra Launch owner bot · بوت مالك تدمر لانش\n\n/platform — open or close the platform, ZNBt status, reports\n/platform — فتح/إغلاق المنصة وحالة ZNBt والبلاغات\n\nOnly the owner can use this bot. · للمالك فقط.";

const appUrl = (lang: "en" | "ar" = "en") => `${HOSTING.gateUrl}/zenobia/coins.html${lang === "ar" ? "?lang=ar" : ""}`;
// Users see English only; Arabic appears for the owner (under the English) and for anyone who taps the language button.
const WELCOME = {
  en: "🪙 Palmyra Launch\nLaunch and trade coins on TON, with fixed fees shown before you confirm.\nNothing here is financial advice or a promise of profit.",
  ar: "🪙 Palmyra Launch · تدمر لانش\nأطلق عملتك وتداولها على TON برسوم ثابتة تظهر قبل التأكيد.\nلا نصيحة مالية ولا وعد بربح.",
};

/** The mini-app button (also the menu button next to the message box) and the language switch; the owner gets one more button, nobody else does. */
export const appKeyboard = (lang: "en" | "ar" = "en", isOwner = false) => {
  const kb = new InlineKeyboard().webApp(lang === "ar" ? "🪙 افتح Palmyra Launch" : "🪙 Open Palmyra Launch", appUrl(lang));
  kb.row().text(lang === "ar" ? "🌐 English" : "🌐 العربية", lang === "ar" ? "pl:en" : "pl:ar");
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
    else if (data === "pl:ar" || data === "pl:en") {
      const l = data === "pl:ar" ? "ar" : "en";
      await bot.api.editMessageText(chatId, cq.message.message_id, WELCOME[l], { reply_markup: appKeyboard(l, isOwner) }).catch(() => null);
    }
    return;
  }
  const text = String(body.message?.text || "").trim();
  if (/^\/start(@\w+)?$/i.test(text)) {
    await bot.api.setChatMenuButton({ chat_id: chatId, menu_button: { type: "web_app", text: "Palmyra Launch", web_app: { url: appUrl(isOwner ? "ar" : "en") } } }).catch(() => null);
    await bot.api.sendMessage(chatId, isOwner ? `${WELCOME.en}\n\n${WELCOME.ar}` : WELCOME.en, { reply_markup: appKeyboard(isOwner ? "ar" : "en", isOwner) });
  } else if (/^\/platform(@\w+)?$/i.test(text) && isOwner) {
    const p = await platformText();
    await bot.api.sendMessage(chatId, p.text, { reply_markup: platformKeyboard(p.open), link_preview_options: { is_disabled: true } });
  } else if (text.startsWith("/") && isOwner) {
    await bot.api.sendMessage(chatId, HELP);
  }
}
