export type BotCallbackRestriction = "banned" | "muted";

/** Shared moderation rule for stale Telegram inline buttons. */
export function botCallbackRestriction(
  isBanned: boolean,
  mutedUntil: Date | string | null | undefined,
  now = Date.now(),
): BotCallbackRestriction | null {
  if (isBanned) return "banned";
  if (!mutedUntil) return null;
  const until = mutedUntil instanceof Date ? mutedUntil.getTime() : new Date(mutedUntil).getTime();
  return Number.isFinite(until) && until > now ? "muted" : null;
}
