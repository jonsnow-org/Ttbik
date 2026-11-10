/**
 * MARRIAGE_BOT guard rules (phase 4 audit) — pure, unit-tested in matchGuards.test.ts.
 * Kept free of prisma/grammy imports so the Telegram webhook can use them cheaply.
 */
import { parseStarsPayload } from "@/lib/starsPayment";
import { isBuyNowKey } from "@/lib/match/entitlementRules";
import { MATCHMAKER_STARS_KIND } from "@/lib/match/trustRules";

/**
 * Moderation status for a saved/edited profile. Owner decision (2026-10-11): new and edited
 * profiles go live at once; only a profile the admin REJECTED goes back to review. The old rule
 * looked at REJECTED only, so saving a second time (status now PENDING) published a rejected
 * profile without review. A profile still waiting for review stays PENDING until the admin decides.
 */
export function nextProfileStatus(existingStatus: string | null | undefined): "APPROVED" | "PENDING" {
  return existingStatus === "REJECTED" || existingStatus === "PENDING" ? "PENDING" : "APPROVED";
}

/**
 * pre_checkout for MARRIAGE_BOT Stars invoices. The successful_payment handler credits only when
 * the payer is the user named in the payload (MATCH_DEPOSIT:<uid> …). A forwarded invoice or a
 * shared invoice link paid by someone else used to be approved here and then credited to nobody,
 * so that payer lost the Stars. Reject it before money moves; unknown kinds are rejected too.
 */
export const MATCH_PAYER_MISMATCH_TEXT = "هذه الفاتورة خاصة بحساب آخر — افتح البوت من حسابك وأنشئ فاتورتك.";
export const MATCH_UNKNOWN_INVOICE_TEXT = "فاتورة غير صالحة — أنشئ فاتورة جديدة من البوت.";
export function matchPreCheckout(payload: string, payerId: string | number): { ok: true } | { ok: false; message: string } {
  const parsed = parseStarsPayload(String(payload || ""));
  if (!parsed) return { ok: false, message: MATCH_UNKNOWN_INVOICE_TEXT };
  const kindOk =
    parsed.kind === "MATCH_DEPOSIT" ||
    parsed.kind === MATCHMAKER_STARS_KIND ||
    (parsed.kind.startsWith("MATCH_BUY_") && isBuyNowKey(parsed.kind.slice("MATCH_BUY_".length)));
  if (!kindOk) return { ok: false, message: MATCH_UNKNOWN_INVOICE_TEXT };
  if (parsed.userId !== String(payerId)) return { ok: false, message: MATCH_PAYER_MISMATCH_TEXT };
  return { ok: true };
}
