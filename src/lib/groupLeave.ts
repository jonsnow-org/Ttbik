/**
 * The owner can make the chains bot leave a group he cannot remove it from (he is not its admin) and tidy up after it.
 *   - in the group:  /leave  (or /leave@<bot>)  — only the platform owner (SUPER_ADMIN_TELEGRAM_ID) is obeyed;
 *   - in the bot's private chat:  /leave <chat id>.
 * Tidy-up: the bot deletes the messages it can find — those the khatma and contest tables recorded, plus every id between the oldest of them
 * and the command (a bot that is not an admin can delete only its own messages, so other people's messages in that range are simply refused;
 * if the bot IS an admin the range scan is skipped so it can never delete other people's messages). Then it closes that chat's open khatma
 * and contest rounds (so the group is not shown on the public pages) and calls leaveChat. Telegram lets a bot delete only recent messages (48 h).
 */
import type { Bot as TelegramBot } from "grammy";
import type { Bot as BotRow } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isOwnerUser } from "@/lib/ownerPanel";

export const LEAVE_CMD = /^\/(leave|اخرج)(@[A-Za-z0-9_]+)?(\s|$)/i;
export const LEAVE_PRIVATE = /^\/leave\s+(-?\d{5,20})\s*$/i;
const MAX_RANGE = 400;

/** Which message ids to try deleting: the recorded ones plus the whole window up to the command when it is small. Pure. */
export function idsToDelete(recorded: number[], upTo: number | null, botIsAdmin: boolean): number[] {
  const ids = new Set(recorded.filter((n) => Number.isFinite(n) && n > 0));
  if (!botIsAdmin && upTo && ids.size) {
    const lo = Math.max(1, Math.min(...ids) - 3);
    if (upTo - lo <= MAX_RANGE) for (let i = lo; i <= upTo; i++) ids.add(i);
  }
  return [...ids].sort((a, b) => a - b);
}

async function recordedIds(botId: string, chatId: string): Promise<number[]> {
  const out: number[] = [];
  for (const q of [
    () => prisma.$queryRaw<{ message_id: bigint | null }[]>`SELECT message_id FROM khatma WHERE bot_id = ${botId} AND chat_id = ${chatId} AND message_id IS NOT NULL`,
    () => prisma.$queryRaw<{ message_id: bigint | null }[]>`SELECT message_id FROM contest_rounds WHERE bot_id = ${botId} AND chat_id = ${chatId} AND message_id IS NOT NULL`,
  ]) {
    try { for (const r of await q()) if (r.message_id != null) out.push(Number(r.message_id)); } catch { /* table not created yet */ }
  }
  return out;
}

export async function leaveGroup(bot: TelegramBot, botRow: BotRow, chatId: number | string, upToMessageId: number | null): Promise<{ deleted: number; left: boolean }> {
  const chat = String(chatId);
  const me = await bot.api.getMe().catch(() => null);
  const member = me ? await bot.api.getChatMember(chatId, me.id).catch(() => null) : null;
  const botIsAdmin = !!member && ["administrator", "creator"].includes(member.status);
  const ids = idsToDelete(await recordedIds(botRow.id, chat), upToMessageId, botIsAdmin);
  let deleted = 0;
  for (const id of ids) {
    const ok = await bot.api.deleteMessage(chatId, id).then(() => true).catch(() => false);
    if (ok) deleted++;
  }
  try { await prisma.$executeRaw`UPDATE khatma SET status = 'CLOSED' WHERE bot_id = ${botRow.id} AND chat_id = ${chat} AND status = 'ACTIVE'`; } catch { /* no table */ }
  try { await prisma.$executeRaw`UPDATE contest_rounds SET status = 'EXPIRED', finished_at = now() WHERE bot_id = ${botRow.id} AND chat_id = ${chat} AND status = 'ACTIVE'`; } catch { /* no table */ }
  const left = await bot.api.leaveChat(chatId).then(() => true).catch(() => false);
  return { deleted, left };
}

/** Group update: true when it was the owner's /leave (the bot left). Anyone else's /leave is ignored. */
export async function tryOwnerLeave(bot: TelegramBot, botRow: BotRow, update: any): Promise<boolean> {
  const msg = update?.message;
  if (!msg?.chat || !msg.from || (msg.chat.type !== "group" && msg.chat.type !== "supergroup")) return false;
  if (!LEAVE_CMD.test(String(msg.text || "").trim()) || !isOwnerUser(msg.from.id)) return false;
  await leaveGroup(bot, botRow, msg.chat.id, Number(msg.message_id) || null);
  return true;
}
