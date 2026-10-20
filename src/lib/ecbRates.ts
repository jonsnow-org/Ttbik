export type EcbRate = {
  currency: string;
  nameAr: string;
  perEuro: number;
};

export type EcbSnapshot = {
  date: string;
  sourceName: string;
  sourceUrl: string;
  rates: EcbRate[];
  fetchedAtIso: string;
} | null;

const NAMES: Record<string, string> = {
  USD: "دولار أمريكي",
  GBP: "جنيه إسترليني",
  JPY: "ين ياباني",
  CHF: "فرنك سويسري",
  CAD: "دولار كندي",
  AUD: "دولار أسترالي",
  CNY: "يوان صيني",
  TRY: "ليرة تركية",
  INR: "روبية هندية",
  KRW: "وون كوري",
  BRL: "ريال برازيلي",
  ZAR: "راند جنوب أفريقي",
  SEK: "كرونة سويدية",
  NOK: "كرونة نرويجية",
  DKK: "كرونة دنماركية",
  PLN: "زلوتي بولندي",
  CZK: "كرونة تشيكية",
  HUF: "فورنت مجري",
  RON: "ليو روماني",
  BGN: "ليف بلغاري",
  SGD: "دولار سنغافوري",
  HKD: "دولار هونغ كونغ",
  MXN: "بيزو مكسيكي",
  NZD: "دولار نيوزيلندي",
  ILS: "شيكل إسرائيلي",
  IDR: "روبية إندونيسية",
  MYR: "رينغيت ماليزي",
  PHP: "بيزو فلبيني",
  THB: "بات تايلاندي",
  ISK: "كرونة آيسلندية",
};

const ECB_XML = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

export async function fetchEcbRates(): Promise<EcbSnapshot> {
  try {
    const res = await fetch(ECB_XML, {
      next: { revalidate: 3600 },
      headers: { Accept: "application/xml,text/xml" },
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const dateMatch = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/);
    if (!dateMatch) return null;
    const rates: EcbRate[] = [];
    const re = /currency=['"]([A-Z]{3})['"]\s+rate=['"]([0-9.]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) {
      const currency = m[1];
      const perEuro = Number(m[2]);
      if (!Number.isFinite(perEuro) || perEuro <= 0) continue;
      rates.push({
        currency,
        nameAr: NAMES[currency] ?? currency,
        perEuro,
      });
    }
    if (!rates.length) return null;
    rates.sort((a, b) => a.currency.localeCompare(b.currency));
    return {
      date: dateMatch[1],
      sourceName: "المصرف المركزي الأوروبي — eurofxref-daily",
      sourceUrl: ECB_XML,
      rates,
      fetchedAtIso: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Currencies officially fixed to the US dollar. The ECB table has no row for them, but their euro price follows exactly from the ECB's EUR/USD
 * and the published peg, so it can be shown without inventing anything. Floating currencies (EGP, IQD, LBP...) are NOT here on purpose.
 */
export const USD_PEGS = [
  { currency: "SAR", nameAr: "ريال سعودي", perUsd: 3.75 },
  { currency: "AED", nameAr: "درهم إماراتي", perUsd: 3.6725 },
  { currency: "QAR", nameAr: "ريال قطري", perUsd: 3.64 },
  { currency: "BHD", nameAr: "دينار بحريني", perUsd: 0.376 },
  { currency: "OMR", nameAr: "ريال عماني", perUsd: 0.3845 },
  { currency: "JOD", nameAr: "دينار أردني", perUsd: 0.709 },
] as const;

export type PeggedRate = { currency: string; nameAr: string; perUsd: number; perEuro: number };

/** Units per 1 euro for the pegged currencies, from the snapshot's EUR/USD; empty when the snapshot has no USD row. */
export function peggedRates(snap: EcbSnapshot): PeggedRate[] {
  const usd = snap?.rates.find((r) => r.currency === "USD")?.perEuro;
  if (!usd) return [];
  return USD_PEGS.map((p) => ({ ...p, perEuro: Math.round(usd * p.perUsd * 10000) / 10000 }));
}
