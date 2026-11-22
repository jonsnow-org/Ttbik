/**
 * Bot API 10.4 (2026-11-09): a button tap can trigger an ephemeral reply visible only to the user who tapped,
 * in any chat (groups included): sendMessage with ephemeral_message_parameters = { callback_query_id }, no chat_id.
 * It must be sent within 15 seconds of the tap. If Telegram refuses it (older API behaviour, expired tap) we fall back to the
 * classic alert popup of answerCallbackQuery, so the user always gets the text.
 */
import type { Bot as TelegramBot } from "grammy";
import { rawCall } from "@/lib/telegramRaw";

export async function replyEphemeral(bot: TelegramBot, callbackQueryId: string, text: string): Promise<"ephemeral" | "popup"> {
  try {
    await rawCall(bot, "sendMessage", { ephemeral_message_parameters: { callback_query_id: callbackQueryId }, text });
    await bot.api.answerCallbackQuery(callbackQueryId).catch(() => null);
    return "ephemeral";
  } catch {
    await bot.api.answerCallbackQuery(callbackQueryId, { text: text.slice(0, 200), show_alert: true }).catch(() => null);
    return "popup";
  }
}
