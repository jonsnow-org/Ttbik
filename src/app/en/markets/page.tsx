import type { Metadata } from "next";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import AdSlot from "@/components/AdSlot";
import { fetchEnMarkets } from "@/lib/autoFeeds";
import { SITE_URL } from "@/lib/siteUrl";

export const revalidate = 300;

export const metadata: Metadata = {
  title: { absolute: "Live Markets: Indices, Forex, Gold, Oil, Crypto | Sham AI" },
  description: "Live-updating table of major stock indices, currency pairs (EUR/USD, GBP/USD, USD/JPY), gold, silver, oil and crypto.",
  alternates: { canonical: `${SITE_URL}/en/markets`, languages: { en: `${SITE_URL}/en/markets`, ar: `${SITE_URL}/markets` } },
};

const n = (v: number | null, d = 2) => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));

export default async function Page() {
  const d = await fetchEnMarkets();
  const rows: [string, string, string?][] = [
    ...d.quotes.map((q) => [q.name, `${q.unit || ""}${n(q.price, q.unit ? 2 : 0)}`, q.pct == null ? undefined : `${q.pct >= 0 ? "+" : ""}${q.pct.toFixed(2)}%`] as [string, string, string?]),
    ["Gold (per oz)", `$${n(d.goldUsd, 0)}`],
    ["Silver (per oz)", `$${n(d.silverUsd)}`],
    ["Bitcoin", `$${n(d.btc, 0)}`],
    ["Ethereum", `$${n(d.eth, 0)}`],
    ...d.fx.map((f) => [f.pair, n(f.rate, f.rate && f.rate > 20 ? 2 : 4)] as [string, string]),
  ];
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en" dir="ltr">
      <EnglishDeskNav />
      <h1 className="text-3xl font-black tracking-tight text-slate-950">Global markets</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">Major indices, currency pairs, metals, oil and crypto. Refreshed every five minutes. Prices are indicative and may be delayed; this is not investment advice.</p>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {rows.map(([name, value, change]) => (
          <article key={name} className="rounded-2xl border border-slate-200 bg-white p-4">
            <h2 className="text-xs font-bold text-slate-500">{name}</h2>
            <p className="mt-1 text-xl font-extrabold text-slate-900">{value}</p>
            {change ? <p className={`mt-1 text-sm font-bold ${change.startsWith("-") ? "text-red-600" : "text-emerald-700"}`}>{change}</p> : null}
          </article>
        ))}
      </div>
      <p className="mt-3 text-xs text-slate-500">Sources: Yahoo Finance, Frankfurter (ECB rates), gold-api.com.</p>
      <div className="mt-6"><AdSlot position="in-content" label="English markets" /></div>
    </main>
  );
}
