// Remittances via USDT (owner, 2026-11-10): the section exists to EARN, not to inform. Users swap/send inside a partner exchanger's
// widget (see widgets.ts) and the owner gets that exchanger's partner commission on every completed swap. Non-custodial: the site
// never receives, holds or forwards anyone's money.
//
// Only exchangers whose affiliate program the owner can join without ID checks are kept here; nothing shows for one until the owner
// sets his referral link or partner id (Telegram /ref on @Admen10bot, or env REMIT_REF_<KEY>).

export type Provider = { key: string; name: string; url: string; note: string };

export const PROVIDERS: Provider[] = [
  { key: "CHANGENOW", name: "ChangeNOW", url: "https://changenow.io/", note: "تبديل فوري بين أكثر من 1000 عملة رقمية دون حساب." },
  { key: "FIXEDFLOAT", name: "FixedFloat", url: "https://ff.io/", note: "تبديل بسعر ثابت أو متغير دون حساب." },
  { key: "EXOLIX", name: "Exolix", url: "https://exolix.com/", note: "تبديل بسعر ثابت لأكثر من 400 عملة." },
  { key: "STEALTHEX", name: "StealthEX", url: "https://stealthex.io/", note: "تبديل فوري لأكثر من 2000 أصل رقمي." },
];

/**
 * The owner's referral link for a provider (admin setting first, then env `REMIT_REF_<KEY>`), https only; `sponsored` is false when
 * none is set (the caller then hides the provider: an official link earns nothing).
 */
export function providerLink(p: Provider, env: Record<string, string | undefined> = process.env, saved: Record<string, string> = {}): { href: string; sponsored: boolean } {
  const ref = (saved[p.key] || env[`REMIT_REF_${p.key}`])?.trim();
  if (ref && /^https:\/\/[^\s]+$/.test(ref)) return { href: ref, sponsored: true };
  return { href: p.url, sponsored: false };
}

/** A bot id passed by the bot's button (`?bot=`), kept only when it looks like one. Pure. */
export function botParam(v: unknown): string | null {
  const s = String(Array.isArray(v) ? v[0] : v ?? "").trim();
  return /^[A-Za-z0-9_-]{4,40}$/.test(s) ? s : null;
}

/** The remittance section's button in the bots (main menu of @Admen10bot and of every ad bot made by the builder). */
export const REMIT_BUTTON = "💸 حوالات USDT";
export function isRemitRequest(text: string | null | undefined): boolean {
  const t = String(text || "").trim();
  return t === REMIT_BUTTON || /^\/remit(@\w+)?$/i.test(t);
}
/** Mini App URL of the section, tagged with the bot that opened it. Pure. */
export function remitAppUrl(site: string, botId: string): string {
  return `${site.replace(/\/$/, "")}/remit?bot=${encodeURIComponent(botId)}&src=tg`;
}
export const REMIT_INTRO = "💸 حوالات USDT: بدّل وأرسل USDT (TRC20) لأي محفظة خلال دقائق، من داخل تيليجرام ودون حساب. اضغط الزر:";
