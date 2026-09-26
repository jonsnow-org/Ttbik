import { InlineKeyboard, type Bot as TelegramBot } from "grammy";
import { Prisma } from "@prisma/client";
import { creditOnce } from "@/lib/paymentCredit";

/**
 * Telegram Stars (XTR) — Telegram's own in-app currency (owner spec,
 * 2026-09-26: "حلله ان كان سهلا ولايوجد تعقيدات قم ببناء نظام دفع موحد").
 * A buyer pays straight out of their Telegram Stars balance; grammy's
 * sendInvoice needs only currency "XTR" and an empty provider_token — no
 * payment provider, no signup, no fee to the bot owner. Stars accumulate in
 * the bot's own Telegram balance and are withdrawn later via Fragment.
 *
 * One shared module for every bot template (MARRIAGE_BOT, CONFESSION_BOT,
 * JOBS_BOT, …) that has its own USD-equivalent balance — each bot keeps
 * crediting its own isolated ledger (MatchTransaction / ConfessionTransaction
 * / JobsTransaction, same as an existing NOWPayments deposit), Stars is just
 * a second way to fund it. Nothing here reads or writes across bots.
 *
 * Rate: 100 Stars = $1 of internal balance. Telegram sells Stars to buyers
 * at roughly $0.013–$0.02 each depending on region/bundle, so this rate
 * never credits the user more than the owner will get back on withdrawal.
 */
export const STARS_PER_USD = 100;

export function starsForUsd(usd: number): number {
  return Math.max(1, Math.ceil(usd * STARS_PER_USD));
}
export function usdForStars(stars: number): number {
  return stars / STARS_PER_USD;
}

// Fixed top-up tiers shown in every bot's deposit screen.
export const STAR_DEPOSIT_TIERS = [100, 300, 500, 1000, 2000] as const;

// Two buttons per row, callback_data "<callbackPrefix>|<stars>" — each bot
// picks its own short prefix (e.g. "mstars", "cstars", "jstars") and reads
// it back the same way it already reads its other callback prefixes.
export function starsDepositKeyboard(callbackPrefix: string): InlineKeyboard {
  const kb = new InlineKeyboard();
  STAR_DEPOSIT_TIERS.forEach((stars, i) => {
    kb.text(`⭐ ${stars} ($${usdForStars(stars).toFixed(2)})`, `${callbackPrefix}|${stars}`);
    if (i % 2 === 1) kb.row();
  });
  return kb;
}

export async function sendStarsInvoice(
  bot: TelegramBot,
  chatId: number,
  opts: { title: string; description: string; payload: string; stars: number }
): Promise<boolean> {
  try {
    await bot.api.sendInvoice(chatId, opts.title, opts.description, opts.payload, "XTR", [
      { label: opts.title, amount: opts.stars },
    ]);
    return true;
  } catch (e) {
    console.error("[stars] sendInvoice failed", e);
    return false;
  }
}

// Every invoice this platform sends carries "<kind>:<userId>" as its
// payload — parsed back out of successful_payment to know whose balance to
// credit and which bot's ledger it belongs to. "kind" values in use:
// MATCH_DEPOSIT, CONFESSION_DEPOSIT, JOBS_DEPOSIT, ADBOT_DEPOSIT.
export function starsPayload(kind: string, userId: string): string {
  return `${kind}:${userId}`;
}
export function parseStarsPayload(payload: string): { kind: string; userId: string } | null {
  const i = payload.indexOf(":");
  if (i < 0) return null;
  return { kind: payload.slice(0, i), userId: payload.slice(i + 1) };
}

type Tx = Prisma.TransactionClient;

/**
 * Credits a successful Stars payment into one bot's own balance/ledger,
 * exactly once — keyed on Telegram's own telegram_payment_charge_id, same
 * idempotency shape as creditOnce's NOWPayments txHash. Telegram does not
 * redeliver successful_payment on a failure the way NOWPayments retries its
 * IPN, so a "retry" outcome here is only ever logged, not retried — the
 * charge itself already succeeded on Telegram's side regardless.
 */
export async function creditStarsPayment(
  label: string,
  record: (tx: Tx) => Promise<unknown>,
  apply: (tx: Tx) => Promise<unknown>
): Promise<"ok" | "duplicate" | "retry"> {
  return creditOnce(label, record, apply);
}
