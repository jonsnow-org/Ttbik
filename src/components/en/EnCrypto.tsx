"use client";

import { useEffect, useState } from "react";
import { Card, Field, Result, num, fmt } from "./EnUi";
import type { EnMarkets } from "@/lib/autoFeeds";

const UNITS = ["USD", "EUR", "GBP", "BTC", "ETH", "Gold (oz)", "Silver (oz)"] as const;
type Unit = (typeof UNITS)[number];

export default function EnCrypto() {
  const [d, setD] = useState<EnMarkets | null>(null);
  const [amount, setAmount] = useState("1");
  const [from, setFrom] = useState<Unit>("BTC");
  const [to, setTo] = useState<Unit>("USD");
  useEffect(() => {
    fetch("/api/markets-en").then((r) => r.json()).then(setD).catch(() => setD(null));
  }, []);
  const fx = (pair: string) => d?.fx.find((f) => f.pair === pair)?.rate ?? null;
  const usdPer = (u: Unit): number | null => {
    switch (u) {
      case "USD": return 1;
      case "EUR": return fx("EUR/USD");
      case "GBP": return fx("GBP/USD");
      case "BTC": return d?.btc ?? null;
      case "ETH": return d?.eth ?? null;
      case "Gold (oz)": return d?.goldUsd ?? null;
      case "Silver (oz)": return d?.silverUsd ?? null;
    }
  };
  const a = usdPer(from);
  const b = usdPer(to);
  const out = a != null && b != null && b > 0 ? (num(amount) * a) / b : null;
  const sel = (v: Unit, set: (u: Unit) => void, label: string) => (
    <label className="block text-sm font-bold text-slate-700">
      {label}
      <select value={v} onChange={(e) => set(e.target.value as Unit)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 font-normal">
        {UNITS.map((u) => <option key={u}>{u}</option>)}
      </select>
    </label>
  );
  return (
    <Card>
      <Field label="Amount" value={amount} set={setAmount} />
      <div className="grid grid-cols-2 gap-3">
        {sel(from, setFrom, "From")}
        {sel(to, setTo, "To")}
      </div>
      <Result label={d ? `${amount || 0} ${from} =` : "Loading live prices…"} value={out == null ? "—" : `${fmt(out, out > 100 ? 2 : 6)} ${to}`} />
      <p className="text-xs text-slate-500">Indicative prices refreshed every few minutes (ECB rates, gold-api.com). Not investment advice.</p>
    </Card>
  );
}
