import type { Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";

const SUPER_ADMIN_ID = process.env.SUPER_ADMIN_TELEGRAM_ID || "";

/**
 * Accept the formats Telegram bot owners commonly paste into the admin panel:
 * @channel, t.me/channel, https://t.me/channel, and a private channel id
 * (-100...). For t.me/c/<id>/... links, convert the internal channel id to
 * the Bot API chat id. Invite hashes cannot be used with getChatMember.
 */
export function normalizeRequiredChannel(input: unknown): string | null {
  let value = String(input ?? "").trim();
  if (!value) return null;

  if (/^-100\d{5,15}$/.test(value)) return value;
  value = value.replace(/^@+/, "");

  let path = value;
  if (/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\//i.test(path)) {
    path = path.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
    path = path.replace(/^(?:t\.me|telegram\.me)\//i, "");
    const parts = path.split(/[?#]/, 1)[0].split("/").filter(Boolean);
    if (parts[0]?.toLowerCase() === "c" && /^\d{5,15}$/.test(parts[1] || "")) {
      return `-100${parts[1]}`;
    }
    if (parts[0] === "joinchat" || parts[0]?.startsWith("+")) return null;
    path = parts[0] || "";
  }

  path = path.replace(/^@+/, "").trim();
  return /^[A-Za-z0-9_]{5,32}$/.test(path) ? path : null;
}

export function requiredChannelChatId(channel: string): string {
  const normalized = normalizeRequiredChannel(channel);
  if (!normalized) throw new Error("Invalid required Telegram channel");
  return normalized.startsWith("-100") ? normalized : `@${normalized}`;
}

/**
 * Check the optional mandatory-subscription gate for bot templates.
 * It deliberately preserves the existing fail-open behavior on Telegram API
 * errors/misconfigured admin permissions so a temporary Telegram outage does
 * not lock every user out. Invalid stored configuration fails closed with a
 * clear message and must be corrected by the bot owner.
 */
export async function enforceRequiredChannel(
  bot: TelegramBot,
  botRow: Pick<BotRow, "requiredChannel" | "ownerId">,
  chatId: number,
  telegramUserId: string,
): Promise<boolean> {
  const raw = String(botRow.requiredChannel || "").trim();
  if (!raw || telegramUserId === botRow.ownerId || (SUPER_ADMIN_ID && telegramUserId === SUPER_ADMIN_ID)) return true;

  const channel = normalizeRequiredChannel(raw);
  if (!channel) {
    await bot.api.sendMessage(chatId, "⚠️ إعداد قناة الاشتراك الإجباري غير صالح. تواصل مع مالك البوت لتحديثه.");
    return false;
  }

  try {
    const member = await bot.api.getChatMember(requiredChannelChatId(channel) as any, Number(telegramUserId));
    if (["creator", "administrator", "member"].includes(member.status)) return true;
    const link = channel.startsWith("-100") ? "" : `\nhttps://t.me/${channel}`;
    await bot.api.sendMessage(chatId, `📡 يجب الاشتراك في القناة أولاً: ${channel.startsWith("-100") ? "القناة المطلوبة" : `@${channel}`}${link}`);
    return false;
  } catch {
    return true;
  }
}
