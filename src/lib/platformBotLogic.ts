// The bot of the coin platform (template ZNBT_PLATFORM_BOT): users get a welcome and one mini-app button; the owner gets the same plus a panel button and /platform. It is independent of the Athar and Zenobia bots:
// it only reads the platform's own state (znbtConfig, the coin index, the reports), so any bot row can be moved or replaced without touching it.
import { Bot as TelegramBot, InlineKeyboard } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { HOSTING } from "@/lib/hostingOps";
import { handlePlatformCallback, platformKeyboard, platformText } from "@/lib/hostingPanel";

export const PLATFORM_COMMANDS = [{ command: "start", description: "Open Palmyra Launch" }];

const HELP = "🪙 Palmyra Launch owner bot · بوت مالك تدمر لانش\n\n/platform — open or close the platform, ZNBt status, reports\n/platform — فتح/إغلاق المنصة وحالة ZNBt والبلاغات\n\nOnly the owner can use this bot. · للمالك فقط.";

const appUrl = () => `${HOSTING.gateUrl}/zenobia/coins.html`;
const WELCOME = "🪙 Palmyra Launch\nLaunch and trade coins on TON, with fixed fees shown before you confirm.\nNothing here is financial advice or a promise of profit.\n\nأطلق عملتك وتداولها على TON برسوم ثابتة تظهر قبل التأكيد.\nلا نصيحة مالية ولا وعد بربح.";

/** The one button users get, and the menu button next to the message box, both open the mini app. */
export const appKeyboard = () => new InlineKeyboard().webApp("🪙 Open Palmyra Launch", appUrl());

export async function handlePlatformBotUpdate(bot: TelegramBot, botRow: BotRow, body: any): Promise<void> {
  const cq = body.callback_query;
  const msg = cq?.message ?? body.message;
  const chatId: number | undefined = msg?.chat?.id;
  const from = String((cq?.from ?? body.message?.from)?.id ?? "");
  if (!chatId || !from) return;
  const isOwner = from === botRow.ownerId;
  if (cq) {
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    if (isOwner && String(cq.data || "").startsWith("zp:")) await handlePlatformCallback(bot, chatId, cq.data, cq.message?.message_id);
    return;
  }
  const text = String(body.message?.text || "").trim();
  if (/^\/start(@\w+)?$/i.test(text)) {
    // the owner sees exactly what users see, plus one extra button for the panel
    await bot.api.setChatMenuButton({ chat_id: chatId, menu_button: { type: "web_app", text: "Palmyra Launch", web_app: { url: appUrl() } } }).catch(() => null);
    const kb = appKeyboard();
    if (isOwner) kb.row().text("⚙️ Owner panel · لوحة المالك", "zp:refresh");
    await bot.api.sendMessage(chatId, WELCOME, { reply_markup: kb });
  } else if (/^\/platform(@\w+)?$/i.test(text) && isOwner) {
    const p = await platformText();
    await bot.api.sendMessage(chatId, p.text, { reply_markup: platformKeyboard(p.open), link_preview_options: { is_disabled: true } });
  } else if (text.startsWith("/") && isOwner) {
    await bot.api.sendMessage(chatId, HELP);
  }
}
