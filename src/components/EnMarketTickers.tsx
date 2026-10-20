"use client";

import { useEffect, useState } from "react";
import type { EnMarkets } from "@/lib/autoFeeds";

const n = (v: number | null, d = 2) => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));

function Track({ items }: { items: string[] }) {
  const line = [...items, ...items];
  return (
    <div className="overflow-hidden whitespace-nowrap" dir="ltr">
      <div className="inline-flex min-w-full animate-[marquee_60s_linear_infinite] gap-6 px-4 hover:[animation-play-state:paused]">
        {line.map((item, i) => (
          <span key={`${item}-${i}`} className="text-xs font-bold text-white/95">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

// Ticker for the English desk: majors, indices, metals, oil, crypto — what a
// European or North American reader follows (not the Arabic desk's regional currencies).
export default function EnMarketTickers({ initial }: { initial?: EnMarkets | null }) {
  const [d, setD] = useState<EnMarkets | null>(initial || null);
  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch("/api/markets-en");
        if (!res.ok) return;
        const next = (await res.json()) as EnMarkets;
        if (!stop) setD(next);
      } catch {
        /* keep last values */
      }
    };
    load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, []);

  const arrow = (p: number | null) => (p == null ? "" : p >= 0 ? ` ▲${p.toFixed(2)}%` : ` ▼${Math.abs(p).toFixed(2)}%`);
  const row1 = [
    ...(d?.quotes || []).filter((q) => !q.unit).map((q) => `${q.name} ${n(q.price, 0)}${arrow(q.pct)}`),
  ];
  const row2 = [
    ...(d?.fx || []).map((f) => `${f.pair} ${n(f.rate, f.rate && f.rate > 20 ? 2 : 4)}`),
    `Gold $${n(d?.goldUsd ?? null, 0)}/oz`,
    `Silver $${n(d?.silverUsd ?? null)}/oz`,
    ...(d?.quotes || []).filter((q) => q.unit).map((q) => `${q.name} $${n(q.price)}${arrow(q.pct)}`),
    `Bitcoin $${n(d?.btc ?? null, 0)}`,
    `Ethereum $${n(d?.eth ?? null, 0)}`,
  ];
  if (!row1.length) row1.push("Loading global indices…");
  return (
    <div>
      <style>{`@keyframes marquee{from{transform:translateX(0)}to{transform:translateX(-50%)}}`}</style>
      <a href="/en/advertise" className="block bg-amber-400 px-4 py-2 text-center text-sm font-extrabold text-slate-950">Advertise on Sham AI — reach readers across every page</a>
      <a href="/en/markets" className="block border-b border-slate-800 bg-slate-900" aria-label="Global markets ticker">
        <div className="border-b border-white/10 bg-sky-800/90 py-1.5"><Track items={row1} /></div>
        <div className="bg-slate-900 py-1.5"><Track items={row2} /></div>
      </a>
    </div>
  );
}
