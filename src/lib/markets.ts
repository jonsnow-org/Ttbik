export type FxRow = { code: string; name: string; rate: number | null; source: string };
export type MarketSnapshot = {
  updatedAt: string;
  goldUsd: number | null;
  goldGram24: number | null;
  goldGram21: number | null;
  goldGram21Syp: number | null;
  goldGram21Try: number | null;
  sypPerUsd: number | null;
  tryPerUsd: number | null;
  btc: number | null;
  eth: number | null;
  sol: number | null;
  fx: FxRow[];
  note: string;
};

const FX = [
  { code: "TRY", name: "ليرة تركية" },
  { code: "SYP", name: "ليرة سورية" },
  { code: "SAR", name: "ريال سعودي" },
  { code: "AED", name: "درهم إماراتي" },
  { code: "EGP", name: "جنيه مصري" },
  { code: "IQD", name: "دينار عراقي" },
  { code: "JOD", name: "دينار أردني" },
  { code: "LBP", name: "ليرة لبنانية" },
  { code: "QAR", name: "ريال قطري" },
  { code: "KWD", name: "دينار كويتي" },
  { code: "BHD", name: "دينار بحريني" },
  { code: "OMR", name: "ريال عماني" },
  { code: "YER", name: "ريال يمني" },
  { code: "ILS", name: "شيكل" },
] as const;

const TROY = 31.1034768;

async function getJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": "ShamAI-markets/1.0" },
      next: { revalidate: 300 },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function coinbase(pair: string): Promise<number | null> {
  const data = (await getJson(`https://api.coinbase.com/v2/prices/${pair}/spot`)) as {
    data?: { amount?: string };
  } | null;
  const n = Number(data?.data?.amount);
  return Number.isFinite(n) ? n : null;
}

export async function fetchMarkets(): Promise<MarketSnapshot> {
  const [gold, btc, eth, sol, frank, open] = await Promise.all([
    getJson("https://api.gold-api.com/price/XAU") as Promise<{ price?: number } | null>,
    coinbase("BTC-USD"),
    coinbase("ETH-USD"),
    coinbase("SOL-USD"),
    getJson("https://api.frankfurter.dev/v2/rates?base=USD&quotes=TRY,SAR,AED,EGP,JOD,QAR,KWD,ILS") as Promise<
      { quote?: string; rate?: number }[] | null
    >,
    getJson("https://open.er-api.com/v6/latest/USD") as Promise<{ rates?: Record<string, number> } | null>,
  ]);

  const frankMap = new Map<string, number>();
  if (Array.isArray(frank)) {
    for (const row of frank) {
      if (row.quote && typeof row.rate === "number") frankMap.set(row.quote, row.rate);
    }
  }
  const openRates = open?.rates || {};
  const fx: FxRow[] = FX.map((item) => {
    const fromFrank = frankMap.get(item.code);
    if (typeof fromFrank === "number") return { ...item, rate: fromFrank, source: "Frankfurter" };
    const fromOpen = openRates[item.code];
    if (typeof fromOpen === "number") return { ...item, rate: fromOpen, source: "ExchangeRate-API" };
    return { ...item, rate: null, source: "غير متاح" };
  });

  const goldUsd = typeof gold?.price === "number" ? gold.price : null;
  const gram24 = goldUsd ? goldUsd / TROY : null;
  const gram21 = gram24 ? gram24 * (21 / 24) : null;
  const syp = fx.find((row) => row.code === "SYP")?.rate ?? null;
  const tryRate = fx.find((row) => row.code === "TRY")?.rate ?? null;
  return {
    updatedAt: new Date().toISOString(),
    goldUsd,
    goldGram24: gram24,
    goldGram21: gram21,
    goldGram21Syp: gram21 && syp ? gram21 * syp : null,
    goldGram21Try: gram21 && tryRate ? gram21 * tryRate : null,
    sypPerUsd: syp,
    tryPerUsd: tryRate,
    btc,
    eth,
    sol,
    fx,
    note: "مرجع سوقي مجاني، ليس سعر صرافة محلي ولا توصية. الليرة السورية والعراقية واللبنانية من مزود يومي، والباقي من نشرة فرانكفورتر.",
  };
}
