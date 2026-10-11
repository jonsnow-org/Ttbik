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
      <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([name, value, change]) => (
              <tr key={name} className="border-b border-slate-100 last:border-0">
                <td className="px-4 py-2.5 font-bold text-slate-800">{name}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{value}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums font-bold ${change?.startsWith("-") ? "text-red-600" : "text-emerald-600"}`}>{change || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-500">Sources: Yahoo Finance, Frankfurter (ECB rates), gold-api.com.</p>
      <div className="mt-6"><AdSlot position="in-content" label="English markets" /></div>
    </main>
  );
}
