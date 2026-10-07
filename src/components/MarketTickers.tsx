"use client";

import { useEffect, useState } from "react";
import type { MarketSnapshot } from "@/lib/markets";

function money(n: number | null, digits = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function Track({ items }: { items: string[] }) {
  const line = [...items, ...items];
  return (
    <div className="overflow-hidden whitespace-nowrap">
      <div className="inline-flex min-w-full animate-[marquee_42s_linear_infinite] gap-6 px-4 hover:[animation-play-state:paused]">
        {line.map((item, i) => (
          <span key={`${item}-${i}`} className="text-xs font-bold text-white/95">
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function MarketTickers({ initial }: { initial?: MarketSnapshot | null }) {
  const [data, setData] = useState<MarketSnapshot | null>(initial || null);

  useEffect(() => {
    let stop = false;
    const load = async () => {
      try {
        const res = await fetch("/api/markets", { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as MarketSnapshot;
        if (!stop) setData(next);
      } catch {
        /* الشريط يبقى على آخر رقم */
      }
    };
    if (!data) load();
    const id = setInterval(load, 5 * 60 * 1000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [data]);

  const gold = [
    `ذهب الأونصة ${money(data?.goldUsd ?? null, 0)} $`,
    `غرام 24 ${money(data?.goldGram24 ?? null)} $`,
    `غرام 21 ${money(data?.goldGram21 ?? null)} $`,
    `غرام 21 سوري ${money(data?.goldGram21Syp ?? null, 0)} ل.س`,
    `غرام 21 تركي ${money(data?.goldGram21Try ?? null, 0)} ₺`,
    `دولار/ليرة سورية ${money(data?.sypPerUsd ?? null, 2)}`,
    `دولار/ليرة تركية ${money(data?.tryPerUsd ?? null, 2)}`,
    `بتكوين ${money(data?.btc ?? null, 0)} $`,
    `إيثيريوم ${money(data?.eth ?? null, 0)} $`,
    `سولانا ${money(data?.sol ?? null)} $`,
  ];
  const fx = (data?.fx || []).map((row) => `دولار/${row.name} ${money(row.rate, row.rate && row.rate > 100 ? 0 : 3)}`);
  if (!fx.length) fx.push("الدولار مقابل عملات الشرق الأوسط — جاري الجلب");

  return (
    <div>
    <a href="/advertise" className="block bg-amber-400 px-4 py-2 text-center text-sm font-extrabold text-slate-950">أعلن هنا Advertise — احجز البنر في كل الصفحات</a>
    <a href="/markets" className="block border-b border-slate-800 bg-slate-900" aria-label="شريط أسعار الذهب والعملات">
      <style>{`@keyframes marquee{from{transform:translateX(0)}to{transform:translateX(50%)}}`}</style>
      <div className="border-b border-white/10 bg-amber-700/90 py-1.5">
        <Track items={gold} />
      </div>
      <div className="bg-slate-900 py-1.5">
        <Track items={fx} />
      </div>
    </a>
    </div>
  );
}
