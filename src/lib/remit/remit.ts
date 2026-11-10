// Remittance comparison (idea E): information only. The site never holds, receives or transfers anyone's money; it shows the mid-market
// reference rate (ECB + official USD pegs), lets the user measure the real cost of a quote they got, and links out to licensed providers.
import type { EcbSnapshot } from "@/lib/ecbRates";
import { peggedRates } from "@/lib/ecbRates";

export type MidRate = { currency: string; nameAr: string; perEuro: number; pegged?: boolean };

/** Every currency with a published reference rate: EUR itself, the ECB table, and the USD pegs (SAR, AED, QAR, BHD, OMR, JOD). */
export function midRates(snap: EcbSnapshot): MidRate[] {
  if (!snap) return [];
  return [
    { currency: "EUR", nameAr: "يورو", perEuro: 1 },
    ...snap.rates.map((r) => ({ currency: r.currency, nameAr: r.nameAr, perEuro: r.perEuro })),
    ...peggedRates(snap).map((p) => ({ currency: p.currency, nameAr: p.nameAr, perEuro: p.perEuro, pegged: true })),
  ];
}

/** Units of `to` for one unit of `from`, or null when either currency has no reference rate. */
export function crossRate(rates: Pick<MidRate, "currency" | "perEuro">[], from: string, to: string): number | null {
  const f = rates.find((r) => r.currency === from)?.perEuro;
  const t = rates.find((r) => r.currency === to)?.perEuro;
  if (!f || !t) return null;
  return t / f;
}

export type QuoteCost = {
  fair: number; // what the recipient would get at the mid-market rate with zero fees
  received: number;
  lost: number; // fair - received, in the destination currency
  lostInSource: number; // the same loss expressed in the sending currency
  costPct: number; // total cost (fee + hidden rate margin) as % of the amount sent
  marginPct: number; // the hidden exchange-rate margin alone
};

/**
 * The real cost of a quote: you send `amount` (+`fee`, both in the sending currency) and the provider says the recipient gets `received`.
 * Everything is compared with the mid-market rate, so a "zero fee" offer with a poor rate shows its true price.
 */
export function quoteCost(amount: number, fee: number, received: number, mid: number): QuoteCost | null {
  if (!(amount > 0) || !(mid > 0) || !(received >= 0) || !(fee >= 0)) return null;
  const fair = amount * mid;
  const total = amount + fee;
  const lostInSource = total - received / mid;
  const marginPct = ((fair - received) / fair) * 100;
  return {
    fair: round(fair),
    received: round(received),
    lost: round(fair - received + fee * mid),
    lostInSource: round(lostInSource),
    costPct: round((lostInSource / total) * 100),
    marginPct: round(marginPct),
  };
}

export function verdict(costPct: number): { label: string; tone: "good" | "ok" | "bad" } {
  if (costPct <= 1.5) return { label: "عرض ممتاز", tone: "good" };
  if (costPct <= 4) return { label: "عرض مقبول", tone: "ok" };
  return { label: "عرض مكلف: قارن بغيره", tone: "bad" };
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

export type Provider = { key: string; name: string; url: string; note: string };

/** Licensed providers, linked to their official sites. The user compares and sends there; we never touch the money. */
export const PROVIDERS: Provider[] = [
  { key: "WISE", name: "Wise", url: "https://wise.com/", note: "يحوّل بسعر السوق الوسطي ويُظهر الرسوم منفصلة." },
  { key: "REMITLY", name: "Remitly", url: "https://www.remitly.com/", note: "تسليم نقدي وبنكي ومحافظ في دول عربية كثيرة." },
  { key: "WESTERN_UNION", name: "Western Union", url: "https://www.westernunion.com/", note: "أوسع شبكة استلام نقدي؛ قارن سعر الصرف لا الرسوم فقط." },
  { key: "MONEYGRAM", name: "MoneyGram", url: "https://www.moneygram.com/", note: "استلام نقدي من الوكلاء وتحويل بنكي." },
  { key: "WORLDREMIT", name: "WorldRemit", url: "https://www.worldremit.com/", note: "تحويل لمحافظ الجوال والبنوك والاستلام النقدي." },
  { key: "PAYSEND", name: "Paysend", url: "https://paysend.com/", note: "من بطاقة إلى بطاقة برسوم ثابتة." },
  { key: "REVOLUT", name: "Revolut", url: "https://www.revolut.com/", note: "تحويل بين الحسابات والبنوك من التطبيق." },
];

/**
 * The link to show for a provider: the owner's referral link from env `REMIT_REF_<KEY>` when set (and https), else the official site.
 * `sponsored` drives rel="sponsored" and the visible "رابط إحالة" disclosure.
 */
export function providerLink(p: Provider, env: Record<string, string | undefined> = process.env): { href: string; sponsored: boolean } {
  const ref = env[`REMIT_REF_${p.key}`]?.trim();
  if (ref && /^https:\/\/[^\s]+$/.test(ref)) return { href: ref, sponsored: true };
  return { href: p.url, sponsored: false };
}
