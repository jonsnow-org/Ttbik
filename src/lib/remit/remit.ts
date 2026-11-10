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

export type ProviderGroup = "global" | "turkey" | "gulf" | "syria" | "crypto";
export type Provider = { key: string; name: string; url: string; note: string; group: ProviderGroup };
export const GROUP_TITLES: Record<ProviderGroup, string> = {
  global: "🌍 شركات عالمية",
  turkey: "🇹🇷 من تركيا وإليها",
  gulf: "🇸🇦🇦🇪 من الخليج",
  syria: "🇸🇾 الاستلام داخل سوريا (شركات مرخّصة من مصرف سوريا المركزي)",
  crypto: "🪙 تبديل العملات الرقمية (USDT ⇄ غيرها)",
};

/**
 * Real providers on their OFFICIAL sites only (each checked on 2026-11-10: the site loads and the service exists). No referral link is
 * hard-coded here: the owner's links come from the admin setting (src/lib/remit/refLinks.ts, Telegram /ref) or env REMIT_REF_<KEY>.
 * Syrian companies: only names on the Central Bank of Syria's licensed list (cb.gov.sy). Notes say plainly what a service does NOT do.
 */
export const PROVIDERS: Provider[] = [
  { key: "WESTERN_UNION", group: "global", name: "Western Union", url: "https://www.westernunion.com/", note: "أوسع شبكة استلام نقدي، ومنها سوريا عبر وكلاء محليين (الاستلام بالليرة حسب تعليمات المصرف المركزي)." },
  { key: "MONEYGRAM", group: "global", name: "MoneyGram", url: "https://www.moneygram.com/", note: "استلام نقدي من الوكلاء وتحويل بنكي؛ قارن سعر الصرف لا الرسوم فقط." },
  { key: "RIA", group: "global", name: "Ria Money Transfer", url: "https://www.riamoneytransfer.com/", note: "يرسل لتركيا والخليج ودول عربية كثيرة؛ لا يدعم الاستلام في سوريا حالياً." },
  { key: "REMITLY", group: "global", name: "Remitly", url: "https://www.remitly.com/", note: "تسليم بنكي ونقدي ومحافظ في دول عربية كثيرة (ليس سوريا)." },
  { key: "WORLDREMIT", group: "global", name: "WorldRemit", url: "https://www.worldremit.com/", note: "تحويل لمحافظ الجوال والبنوك والاستلام النقدي." },
  { key: "XE", group: "global", name: "Xe Money Transfer", url: "https://www.xe.com/", note: "تحويل بنكي دولي بسعر قريب من الوسطي، ومرجع معروف لأسعار الصرف." },
  { key: "WISE", group: "global", name: "Wise", url: "https://wise.com/", note: "يحوّل بسعر السوق الوسطي ويُظهر الرسوم منفصلة (خدماته في تركيا محدودة حالياً)." },
  { key: "PAYSEND", group: "global", name: "Paysend", url: "https://paysend.com/", note: "من بطاقة إلى بطاقة برسوم ثابتة." },
  { key: "INSTAREM", group: "global", name: "Instarem", url: "https://www.instarem.com/", note: "تحويل بنكي دولي برسوم منخفضة." },
  { key: "TAPTAP", group: "global", name: "Taptap Send", url: "https://www.taptapsend.com/", note: "من أوروبا والإمارات وأمريكا إلى لبنان ومصر ودول أخرى؛ لا يرسل إلى سوريا." },
  { key: "REVOLUT", group: "global", name: "Revolut", url: "https://www.revolut.com/", note: "تحويل بين الحسابات والبنوك من التطبيق." },
  { key: "UPT", group: "turkey", name: "UPT (Aktif Bank)", url: "https://www.upt.com.tr/", note: "أوسع شبكة تحويل تركية: كل مكاتب PTT ووكلاء UPT، إرسال واستلام بالاسم أو للحساب أو البطاقة." },
  { key: "ALANSARI", group: "gulf", name: "الأنصاري للصرافة (Al Ansari Exchange)", url: "https://alansariexchange.com/", note: "أكبر شبكة فروع صرافة في الإمارات، مع تطبيق للتحويل ووكيل Western Union." },
  { key: "LULU", group: "gulf", name: "لولو للصرافة (LuLu Exchange)", url: "https://luluexchange.com/", note: "فروع في الإمارات والخليج وتطبيق LuLu Money." },
  { key: "ALFUAD_UAE", group: "gulf", name: "الفؤاد للصرافة - دبي (Al Fuad Exchange)", url: "https://alfuadexchange.com/", note: "صرافة وتحويل من الإمارات منذ 2001." },
  { key: "TAHWEEL_ALRAJHI", group: "gulf", name: "تحويل الراجحي (السعودية)", url: "https://www.alrajhibank.com.sa/en/Tahweel", note: "تحويل دولي من السعودية عبر التطبيق والفروع وتطبيق urpay." },
  { key: "ENJAZ", group: "gulf", name: "إنجاز (السعودية)", url: "https://www.enjaz.com/", note: "شركة مدفوعات مرخّصة من البنك المركزي السعودي، تحويل لأكثر من 200 دولة." },
  { key: "STC_BANK", group: "gulf", name: "STC Bank (السعودية)", url: "https://www.stcbank.com.sa/", note: "تحويل دولي من التطبيق." },
  { key: "CHAM_EXCHANGE", group: "syria", name: "شام للصرافة", url: "https://chamexchange.com/", note: "حوالات من الخارج وإليه وبين فروعها في المحافظات، وخدمة شام كاش." },
  { key: "ALFUAD_SY", group: "syria", name: "الفؤاد للحوالات المالية", url: "https://fouadmt.com/", note: "أكثر من 220 مركزاً في المحافظات السورية، وشراكات مع شركات صرافة عالمية." },
  { key: "CHANGENOW", group: "crypto", name: "ChangeNOW", url: "https://changenow.io/", note: "تبديل فوري بين العملات الرقمية دون حساب. لا يرسل حوالة نقدية؛ للتحويل عبر USDT." },
  { key: "FIXEDFLOAT", group: "crypto", name: "FixedFloat", url: "https://ff.io/", note: "تبديل بسعر ثابت أو متغير دون حساب." },
  { key: "EXOLIX", group: "crypto", name: "Exolix", url: "https://exolix.com/", note: "تبديل بسعر ثابت لأكثر من 400 عملة." },
  { key: "STEALTHEX", group: "crypto", name: "StealthEX", url: "https://stealthex.io/", note: "تبديل فوري لأكثر من 2000 أصل رقمي." },
];

/**
 * The link to show for a provider: the owner's referral link (admin setting first, then env `REMIT_REF_<KEY>`) when set and https, else the official site.
 * `sponsored` drives rel="sponsored" and the visible "رابط إحالة" disclosure.
 */
export function providerLink(p: Provider, env: Record<string, string | undefined> = process.env, saved: Record<string, string> = {}): { href: string; sponsored: boolean } {
  const ref = (saved[p.key] || env[`REMIT_REF_${p.key}`])?.trim();
  if (ref && /^https:\/\/[^\s]+$/.test(ref)) return { href: ref, sponsored: true };
  return { href: p.url, sponsored: false };
}
