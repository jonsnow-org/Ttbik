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
