import { prisma } from "@/lib/prisma";

// When an AD_BOT campaign promotes ANOTHER bot on this same platform, its
// carousel hands out a deep link like "https://t.me/OtherBot?start=adv_<id>"
// instead of a bare link (owner spec, 2026-09-06). Since every platform bot
// runs on this same server against this same database, the advertised
// bot's own /start handler can mark that click verified directly — no
// "forward a confirmation message back to AD_BOT" cooperation needed, and
// no way for an unrelated /start payload to collide with this since real
// referral codes are Telegram user ids (numeric), never this prefix.
const AD_VERIFY_PREFIX = "adv_";

export function isAdVerifyPayload(payload: string): boolean {
  return payload.startsWith(AD_VERIFY_PREFIX);
}

// Best-effort: an unknown/already-consumed click id is silently ignored
// (this must never block or break the target bot's own /start reply).
export async function consumeAdVerifyPayload(payload: string): Promise<void> {
  const clickId = payload.slice(AD_VERIFY_PREFIX.length).trim();
  if (!clickId) return;
  await prisma.adClick.update({ where: { id: clickId }, data: { verified: true } }).catch(() => null);
}
