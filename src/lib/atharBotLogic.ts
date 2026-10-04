import { Bot as TelegramBot, InlineKeyboard, Keyboard } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { recordBotVisit } from "@/lib/botVisit";
import { startGuide } from "@/lib/botStartGuide";

/**
 * ATHAR_BOT — «أثر»: رمز لكل يوم في التقويم على TON.
 * البوت لا يحمل منطقاً: يفتح التطبيق المصغر (يعمل على Oracle) وكل شيء آخر يجري داخله وعلى السلسلة.
 */
export const ATHAR_URL = (process.env.NEXT_PUBLIC_ATHAR_URL || "https://athar.89-168-89-15.sslip.io").replace(/\/$/, "");

function menu(): InlineKeyboard {
  return new InlineKeyboard()
    .webApp("🕰 فتح أثر", ATHAR_URL)
    .row()
    .webApp("🎁 صندوق الغموض", `${ATHAR_URL}/mystery`)
    .webApp("🔨 المزادات", `${ATHAR_URL}/auctions`);
}

export async function handleAtharBotUpdate(bot: TelegramBot, botRow: BotRow, body: any): Promise<void> {
  const msg = body.message;
  if (!msg?.chat?.id) {
    if (body.callback_query?.id) await bot.api.answerCallbackQuery(body.callback_query.id).catch(() => null);
    return;
  }
  const chatId = msg.chat.id;
  const text = String(msg.text || "").trim();
  const fromId = String(msg.from?.id || "");
  if (fromId) {
    try { await recordBotVisit(botRow.id, fromId); } catch { /* visit counting is optional */ }
  }
  if (text.startsWith("/start") || text === "🕰 أثر") {
    await bot.api.sendMessage(chatId, startGuide("ATHAR"), { reply_markup: menu() });
    await bot.api.sendMessage(chatId, "القائمة السريعة:", { reply_markup: new Keyboard().text("🕰 أثر").resized().persistent() }).catch(() => null);
    return;
  }
  await bot.api.sendMessage(chatId, "اضغط «🕰 فتح أثر» لفتح التطبيق المصغر.", { reply_markup: menu() });
}
