/**
 * Athar promotion inside the MARRIAGE_BOT Mini App (2026-10-14). OFF unless MATCH_ENABLE_ATHAR=1.
 * Read-only use of Athar: we only BUILD links to Athar's existing public pages — the same
 * `${ATHAR_URL}/date?i=<index>&lang=ar` deep link Athar's own birthday reminder uses
 * (src/app/api/cron/athar-birthdays/route.ts) and Athar's date index (athar/lib/rules indexOf,
 * dates 1950-01-01 … 2049-12-31). The Athar bot has no /start date payload, so the bot link is
 * plain. No payments, no wallet, no Athar code or contract touched. Wording: gift / memory only.
 */
import { prisma } from "@/lib/prisma";
import { ensureMatchAppTables } from "@/lib/match/appStore";
import { ATHAR_URL } from "@/lib/atharBotLogic";
import { atharDateLink, atharHealthy, ymdOf } from "@/lib/atharDay";
export { atharDateLink, atharDay, atharHealthy, dayKeyOf, parseYmd, ymdOf } from "@/lib/atharDay";
export type { Ymd, AtharDay } from "@/lib/atharDay";
import { dayKeyOf, parseYmd, type Ymd } from "@/lib/atharDay";

/** ON by default (owner approved 2026-10-14); MATCH_ENABLE_ATHAR=0|false|off switches it off. */
export function atharEnabled(): boolean {
  return !/^(0|false|off|no)$/i.test(String(process.env.MATCH_ENABLE_ATHAR ?? "").trim());
}
/** Athar web app home (TonConnect + TON payments live there, in Athar's own flow). */
export function atharHomeLink(): string {
  return `${ATHAR_URL}/`;
}
/** Same env/fallback as atharBotLogic's ATHAR_BOT_FALLBACK (that constant is not exported). */
export function atharBotLink(): string {
  return (process.env.NEXT_PUBLIC_ATHAR_BOT_URL || "https://t.me/AtharDaysBot").trim();
}
/** What the app may show; null = render nothing (flag off or Athar down). */
export async function atharClientConfig(now = new Date()): Promise<{ bot: string; today: string; home: string } | null> {
  if (!atharEnabled()) return null;
  const today = atharDateLink(ymdOf(now));
  if (!today || !(await atharHealthy())) return null;
  return { bot: atharBotLink(), today, home: atharHomeLink() };
}

// ---- "moments": first-chat date after a contact exchange / accepted 💍 request -------------------
export type MomentKind = "contact" | "proposal";
export async function recordMoment(userIds: string[], kind: MomentKind, day: Date): Promise<void> {
  await ensureMatchAppTables();
  const key = dayKeyOf(ymdOf(day));
  for (const u of userIds) {
    await prisma.$executeRaw`INSERT INTO match_athar_moments (user_id, kind, day) VALUES (${u}, ${kind}, ${key}) ON CONFLICT DO NOTHING`;
  }
}
export async function pendingMoments(userId: string): Promise<{ kind: string; day: string; link: string }[]> {
  await ensureMatchAppTables();
  const rows = await prisma.$queryRaw<{ kind: string; day: string }[]>`SELECT kind, day FROM match_athar_moments WHERE user_id = ${userId} AND NOT dismissed ORDER BY created_at DESC LIMIT 3`;
  return rows.flatMap((r) => { const y = parseYmd(r.day); const link = y && atharDateLink(y); return link ? [{ kind: r.kind, day: r.day, link }] : []; });
}
export async function dismissMoment(userId: string, kind: string, day: string): Promise<void> {
  await ensureMatchAppTables();
  await prisma.$executeRaw`UPDATE match_athar_moments SET dismissed = true WHERE user_id = ${userId} AND kind = ${kind} AND day = ${day}`;
}

// ---- privacy-safe share page: only the date + the app name; no ids, names, photos or countries ----
export async function createShare(botId: string, day: Date): Promise<string> {
  await ensureMatchAppTables();
  const { randomBytes } = await import("crypto");
  const token = randomBytes(12).toString("base64url");
  await prisma.$executeRaw`INSERT INTO match_share (token, bot_id, day) VALUES (${token}, ${botId}, ${dayKeyOf(ymdOf(day))})`;
  return token;
}
export async function readShare(token: string): Promise<{ botId: string; day: string } | null> {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(token)) return null;
  await ensureMatchAppTables();
  const r = await prisma.$queryRaw<{ bot_id: string; day: string }[]>`SELECT bot_id, day FROM match_share WHERE token = ${token}`;
  return r[0] ? { botId: r[0].bot_id, day: r[0].day } : null;
}

