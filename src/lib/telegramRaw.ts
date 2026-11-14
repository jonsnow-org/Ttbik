import type { Bot as TelegramBot } from "grammy";

/** Calls a Bot API method that grammy's typings do not know yet (Bot API 10.4: widgets, ephemeral replies). The raw API forwards any method name and parameters untouched. */
export async function rawCall<T = unknown>(bot: TelegramBot, method: string, params: Record<string, unknown>): Promise<T> {
  const raw = bot.api.raw as unknown as Record<string, (p: Record<string, unknown>) => Promise<T>>;
  return raw[method](params);
}
