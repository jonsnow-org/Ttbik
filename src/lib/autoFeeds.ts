import { parseFeed, type RssItem } from "@/lib/newsRss";

// Automatic data for the English desk, refreshed by Next's data cache: English
// RSS headlines (title + source + link out to the publisher; no article text
// is copied) and the global-markets ticker.

const UA = "ShamAI/1.0 (https://ttbik.vercel.app; contact via site)";

async function getJson<T>(url: string, revalidate: number): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" }, next: { revalidate }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// ---------- English headlines (RSS) ----------
const EN_FEEDS: { source: string; url: string }[] = [
  { source: "BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml" },
  { source: "The Guardian", url: "https://www.theguardian.com/world/rss" },
  { source: "DW", url: "https://rss.dw.com/xml/rss-en-all" },
  { source: "Al Jazeera English", url: "https://www.aljazeera.com/xml/rss/all.xml" },
  { source: "NPR", url: "https://feeds.npr.org/1001/rss.xml" },
  { source: "France 24", url: "https://www.france24.com/en/rss" },
  { source: "BBC Technology", url: "https://feeds.bbci.co.uk/news/technology/rss.xml" },
];

export async function fetchEnHeadlines(limit = 20): Promise<RssItem[]> {
  const settled = await Promise.allSettled(
    EN_FEEDS.map(async (f) => {
      const res = await fetch(f.url, {
        next: { revalidate: 300, tags: ["news-rss-en"] },
        signal: AbortSignal.timeout(8000),
        headers: { Accept: "application/rss+xml, application/xml, text/xml", "User-Agent": "Mozilla/5.0 (compatible; ShamAI-news/1.0)" },
      });
      if (!res.ok) throw new Error(String(res.status));
      return parseFeed(await res.text(), f.source);
    }),
  );
  const now = Date.now();
  const seen = new Set<string>();
  const all: RssItem[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const it of r.value) {
      const key = it.link.replace(/[?#].*$/, "").replace(/\/+$/, "");
      if (seen.has(key)) continue;
      if (it.ts && now - it.ts > 48 * 3600_000) continue;
      seen.add(key);
      all.push(it);
    }
  }
  all.sort((a, b) => b.ts - a.ts);
  // at most ceil(limit/3) per source so one outlet cannot fill the list
  const per = new Map<string, number>();
  const out: RssItem[] = [];
  for (const it of all) {
    const n = per.get(it.source) ?? 0;
    if (n >= Math.ceil(limit / 3)) continue;
    per.set(it.source, n + 1);
    out.push(it);
    if (out.length >= limit) break;
  }
  return out;
}

// ---------- English markets (ticker) ----------
export type EnMarkets = {
  updatedAt: string;
  goldUsd: number | null;
  silverUsd: number | null;
  btc: number | null;
  eth: number | null;
  fx: { pair: string; rate: number | null }[];
  quotes: { name: string; price: number | null; pct: number | null; unit?: string }[];
};

async function yahoo(symbol: string): Promise<{ price: number | null; pct: number | null }> {
  const data = await getJson<{ chart?: { result?: { meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number } }[] } }>(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`,
    300,
  );
  const meta = data?.chart?.result?.[0]?.meta;
  const price = typeof meta?.regularMarketPrice === "number" ? meta.regularMarketPrice : null;
  const prev = meta?.chartPreviousClose ?? meta?.previousClose;
  const pct = price != null && typeof prev === "number" && prev > 0 ? ((price - prev) / prev) * 100 : null;
  return { price, pct };
}

export async function fetchEnMarkets(): Promise<EnMarkets> {
  const indexSymbols: [string, string, string?][] = [
    ["S&P 500", "^GSPC"],
    ["Nasdaq", "^IXIC"],
    ["Dow Jones", "^DJI"],
    ["FTSE 100", "^FTSE"],
    ["DAX", "^GDAXI"],
    ["CAC 40", "^FCHI"],
    ["Euro Stoxx 50", "^STOXX50E"],
    ["Nikkei 225", "^N225"],
    ["Brent", "BZ=F", "$"],
    ["WTI", "CL=F", "$"],
  ];
  const [gold, silver, btc, eth, fxUsd, fxEur, idx] = await Promise.all([
    getJson<{ price?: number }>("https://api.gold-api.com/price/XAU", 300),
    getJson<{ price?: number }>("https://api.gold-api.com/price/XAG", 300),
    getJson<{ price?: number }>("https://api.gold-api.com/price/BTC", 300),
    getJson<{ price?: number }>("https://api.gold-api.com/price/ETH", 300),
    getJson<{ quote: string; rate: number }[]>("https://api.frankfurter.dev/v2/rates?base=USD&quotes=EUR,GBP,JPY,CHF,CAD,AUD", 300),
    getJson<{ quote: string; rate: number }[]>("https://api.frankfurter.dev/v2/rates?base=EUR&quotes=GBP,CHF", 300),
    Promise.all(indexSymbols.map(([, s]) => yahoo(s))),
  ]);
  const usd = new Map((fxUsd || []).map((r) => [r.quote, r.rate]));
  const eur = new Map((fxEur || []).map((r) => [r.quote, r.rate]));
  const inv = (c: string) => (usd.get(c) ? 1 / (usd.get(c) as number) : null);
  const fx = [
    { pair: "EUR/USD", rate: inv("EUR") },
    { pair: "GBP/USD", rate: inv("GBP") },
    { pair: "USD/JPY", rate: usd.get("JPY") ?? null },
    { pair: "USD/CHF", rate: usd.get("CHF") ?? null },
    { pair: "USD/CAD", rate: usd.get("CAD") ?? null },
    { pair: "AUD/USD", rate: inv("AUD") },
    { pair: "EUR/GBP", rate: eur.get("GBP") ?? null },
    { pair: "EUR/CHF", rate: eur.get("CHF") ?? null },
  ];
  const quotes = indexSymbols.map(([name, , unit], i) => ({ name, unit, price: idx[i].price, pct: idx[i].pct }));
  return {
    updatedAt: new Date().toISOString(),
    goldUsd: gold?.price ?? null,
    silverUsd: silver?.price ?? null,
    btc: btc?.price ?? null,
    eth: eth?.price ?? null,
    fx,
    quotes,
  };
}
