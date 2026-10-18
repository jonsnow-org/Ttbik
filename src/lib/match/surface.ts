/**
 * Per-user "active surface" for the random chat. The Mini App touches
 * match_app_presence on every poll; while that is fresh (≤30s) the user is
 * reading in the app, so partner messages/notices are delivered there only
 * (recorded in match_app_messages + realtime doorbell) and NOT duplicated in
 * Telegram. Otherwise (bot users, app closed) Telegram delivery is unchanged.
 */
import type { Bot as TelegramBot } from "grammy";
import { prisma } from "@/lib/prisma";
import { ensureMatchAppTables } from "@/lib/match/appStore";

export const APP_ACTIVE_WINDOW_MS = 30_000;

/** Pure routing rule. */
export function shouldNotifyTelegram(lastAppSeen: Date | null | undefined, now: number = Date.now(), windowMs = APP_ACTIVE_WINDOW_MS): boolean {
  return !lastAppSeen || now - lastAppSeen.getTime() > windowMs;
}

export async function touchAppPresence(userId: string): Promise<void> {
  try {
    await ensureMatchAppTables();
    await prisma.$executeRaw`INSERT INTO match_app_presence (user_id, last_seen) VALUES (${userId}, now()) ON CONFLICT (user_id) DO UPDATE SET last_seen = now()`;
  } catch { /* presence is best effort */ }
}
export async function appLastSeen(userId: string): Promise<Date | null> {
  try {
    await ensureMatchAppTables();
    const r = await prisma.$queryRaw<{ last_seen: Date }[]>`SELECT last_seen FROM match_app_presence WHERE user_id = ${userId}`;
    return r[0]?.last_seen ?? null;
  } catch {
    return null;
  }
}
export async function isAppActive(userId: string): Promise<boolean> {
  return !shouldNotifyTelegram(await appLastSeen(userId));
}

/** Send to Telegram unless the user is currently in the app. Returns where it went. */
export async function deliverToUser(bot: TelegramBot, userId: string, text: string, extra?: Record<string, unknown>): Promise<"app" | "telegram"> {
  if (await isAppActive(userId)) return "app";
  await bot.api.sendMessage(Number(userId), text, extra as any).catch(() => null);
  return "telegram";
}
