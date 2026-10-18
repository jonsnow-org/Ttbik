// The owner's bot for the coin platform (template ZNBT_PLATFORM_BOT). It is independent of the Athar and Zenobia bots:
// it only reads the platform's own state (znbtConfig, the coin index, the reports), so any bot row can be moved or replaced without touching it.
import { Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { handlePlatformCallback, platformKeyboard, platformText } from "@/lib/hostingPanel";

export const PLATFORM_COMMANDS = [
  { command: "platform", description: "Coin platform: open / close / status" },
  { command: "help", description: "What this bot does" },
];

const HELP = "🪙 Coin platform owner bot · بوت مالك منصة العملات\n\n/platform — open or close the platform, ZNBt status, reports\n/platform — فتح/إغلاق المنصة وحالة ZNBt والبلاغات\n\nOnly the owner can use this bot. · للمالك فقط.";

export async function handlePlatformBotUpdate(bot: TelegramBot, botRow: BotRow, body: any): Promise<void> {
  const cq = body.callback_query;
  const msg = cq?.message ?? body.message;
  const chatId: number | undefined = msg?.chat?.id;
  const from = String((cq?.from ?? body.message?.from)?.id ?? "");
  if (!chatId || !from) return;
  if (from !== botRow.ownerId) {
    if (cq) await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    else if (body.message?.text?.startsWith("/")) await bot.api.sendMessage(chatId, "This bot is for the platform owner only. · هذا البوت للمالك فقط.").catch(() => null);
    return;
  }
  if (cq) {
    await bot.api.answerCallbackQuery(cq.id).catch(() => null);
    if (String(cq.data || "").startsWith("zp:")) await handlePlatformCallback(bot, chatId, cq.data, cq.message?.message_id);
    return;
  }
  const text = String(body.message?.text || "").trim();
  if (/^\/(platform|start)(@\w+)?$/i.test(text)) {
    const p = await platformText();
    await bot.api.sendMessage(chatId, p.text, { reply_markup: platformKeyboard(p.open), link_preview_options: { is_disabled: true } });
  } else if (text.startsWith("/")) {
    await bot.api.sendMessage(chatId, HELP);
  }
}
