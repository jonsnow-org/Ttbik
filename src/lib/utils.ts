export function generateOrderCode(): string {
  const rand = crypto.randomUUID().split("-")[0].toUpperCase();
  return `ORD-${rand}`;
}

export function formatUsd(amount: number): string {
  if (amount === 0) return "مجاني";
  return `$${amount.toFixed(2)}`;
}

/**
 * Owner directive 2026-09-22: every bot broadcast should read as a
 * user-facing "#تحديث" update announcement by default, so users are
 * routinely told what changed without the admin having to remember to
 * tag it each time. If the composed text already starts with its own
 * "#" hashtag (e.g. a non-update notice like "#تنبيه"), leave it as-is
 * instead of double-tagging.
 */
export function formatBroadcastText(text: string): string {
  const trimmed = text.trim();
  return trimmed.startsWith("#") ? trimmed : `#تحديث\n\n${trimmed}`;
}

export const BROADCAST_COMPOSE_HINT =
  "اذكر فقط ما أضفناه أو حسّنّاه (بصيغة نقاط بسيطة) — دون ذكر أي تفاصيل داخلية أو حساسة عن سير العمل. سيبدأ الإعلان تلقائياً بـ #تحديث ما لم تبدأ رسالتك بوسم آخر بنفسك.";
