"use client";

import { useCallback, useEffect, useState } from "react";

type Rates = {
  ton: { usd: number; sar: number };
  btc: { usd: number; sar: number };
  eth: { usd: number; sar: number };
  usdt: { usd: number; sar: number };
};

const COINS = [
  { id: "ton", label: "TON", name: "Toncoin" },
  { id: "btc", label: "BTC", name: "Bitcoin" },
  { id: "eth", label: "ETH", name: "Ethereum" },
  { id: "usdt", label: "USDT", name: "Tether" },
  { id: "usd", label: "USD", name: "دولار أمريكي" },
  { id: "sar", label: "SAR", name: "ريال سعودي" },
] as const;

type CoinId = (typeof COINS)[number]["id"];

function toUsd(amount: number, from: CoinId, rates: Rates): number {
  if (from === "usd") return amount;
  if (from === "sar") return amount / rates.usdt.sar; // approx via USDT≈1 USD; better use explicit
  // Use USDT as 1 USD proxy for SAR conversion base; actual SAR from coingecko per coin
  if (from === "ton") return amount * rates.ton.usd;
  if (from === "btc") return amount * rates.btc.usd;
  if (from === "eth") return amount * rates.eth.usd;
  if (from === "usdt") return amount * rates.usdt.usd;
  return amount;
}

function fromUsd(usd: number, to: CoinId, rates: Rates): number {
  if (to === "usd") return usd;
  if (to === "sar") {
    // Prefer TON's SAR/USD ratio if available, else USDT
    const sarPerUsd = rates.ton.sar / rates.ton.usd || rates.usdt.sar / rates.usdt.usd || 3.75;
    return usd * sarPerUsd;
  }
  if (to === "ton") return usd / rates.ton.usd;
  if (to === "btc") return usd / rates.btc.usd;
  if (to === "eth") return usd / rates.eth.usd;
  if (to === "usdt") return usd / rates.usdt.usd;
  return usd;
}

function formatNum(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (Math.abs(n) >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (Math.abs(n) >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

export default function CryptoConverter() {
  const [rates, setRates] = useState<Rates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [amount, setAmount] = useState("1");
  const [from, setFrom] = useState<CoinId>("ton");
  const [to, setTo] = useState<CoinId>("usd");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network,bitcoin,ethereum,tether&vs_currencies=usd,sar",
        { next: { revalidate: 60 } as RequestInit["next"] }
      );
      if (!res.ok) throw new Error("فشل جلب الأسعار");
      const data = await res.json();
      setRates({
        ton: { usd: data["the-open-network"]?.usd ?? 0, sar: data["the-open-network"]?.sar ?? 0 },
        btc: { usd: data.bitcoin?.usd ?? 0, sar: data.bitcoin?.sar ?? 0 },
        eth: { usd: data.ethereum?.usd ?? 0, sar: data.ethereum?.sar ?? 0 },
        usdt: { usd: data.tether?.usd ?? 1, sar: data.tether?.sar ?? 3.75 },
      });
    } catch {
      setError("تعذّر جلب الأسعار الحية. حاول مجدداً بعد دقيقة.");
      setRates(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const num = parseFloat(amount.replace(/,/g, "")) || 0;
  let result = 0;
  if (rates && num > 0) {
    // Direct path when both have native rates
    if (from === "ton" && to === "usd") result = num * rates.ton.usd;
    else if (from === "ton" && to === "sar") result = num * rates.ton.sar;
    else if (from === "btc" && to === "usd") result = num * rates.btc.usd;
    else if (from === "btc" && to === "sar") result = num * rates.btc.sar;
    else if (from === "eth" && to === "usd") result = num * rates.eth.usd;
    else if (from === "eth" && to === "sar") result = num * rates.eth.sar;
    else if (from === "usdt" && to === "usd") result = num * rates.usdt.usd;
    else if (from === "usdt" && to === "sar") result = num * rates.usdt.sar;
    else if (from === "usd" && to === "ton") result = num / rates.ton.usd;
    else if (from === "sar" && to === "ton") result = num / rates.ton.sar;
    else if (from === "usd" && to === "btc") result = num / rates.btc.usd;
    else if (from === "sar" && to === "btc") result = num / rates.btc.sar;
    else if (from === "usd" && to === "eth") result = num / rates.eth.usd;
    else if (from === "sar" && to === "eth") result = num / rates.eth.sar;
    else if (from === "usd" && to === "usdt") result = num / rates.usdt.usd;
    else if (from === "sar" && to === "usdt") result = num / rates.usdt.sar;
    else if (from === "usd" && to === "sar") {
      const sarPerUsd = rates.ton.sar / rates.ton.usd || 3.75;
      result = num * sarPerUsd;
    } else if (from === "sar" && to === "usd") {
      const sarPerUsd = rates.ton.sar / rates.ton.usd || 3.75;
      result = num / sarPerUsd;
    } else {
      // Cross via USD
      const usd = toUsd(num, from, rates);
      result = fromUsd(usd, to, rates);
    }
  }

  function swap() {
    setFrom(to);
    setTo(from);
  }

  const fromLabel = COINS.find((c) => c.id === from)?.label ?? from;
  const toLabel = COINS.find((c) => c.id === to)?.label ?? to;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
      {loading && !rates && (
        <p className="text-sm text-slate-500 text-center py-6">جاري جلب الأسعار الحية…</p>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}{" "}
          <button type="button" onClick={load} className="font-bold underline">
            إعادة المحاولة
          </button>
        </div>
      )}

      {rates && (
        <>
          <div className="grid gap-3">
            <div>
              <label className="mb-1 block text-sm font-semibold text-slate-700">المبلغ</label>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                dir="ltr"
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
                placeholder="1"
              />
            </div>
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">من</label>
                <select
                  value={from}
                  onChange={(e) => setFrom(e.target.value as CoinId)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
                >
                  {COINS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} — {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={swap}
                className="mb-0.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-600 hover:bg-slate-100"
                title="تبديل"
              >
                ⇄
              </button>
              <div>
                <label className="mb-1 block text-sm font-semibold text-slate-700">إلى</label>
                <select
                  value={to}
                  onChange={(e) => setTo(e.target.value as CoinId)}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
                >
                  {COINS.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label} — {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-4 text-center">
            <p className="text-xs text-slate-500 mb-1">النتيجة التقريبية</p>
            <p className="text-2xl font-extrabold text-slate-900 dir-ltr" dir="ltr">
              {formatNum(result)}{" "}
              <span className="text-base font-bold text-brand-700">
                {toLabel}
              </span>
            </p>
            <button
              type="button"
              onClick={async () => {
                const lines = [
                  `${formatNum(num)} ${fromLabel} = ${formatNum(result)} ${toLabel}`,
                  rates
                    ? `أسعار تقريبية: TON $${formatNum(rates.ton.usd)} · BTC $${formatNum(rates.btc.usd)} · ETH $${formatNum(rates.eth.usd)} · USDT $${formatNum(rates.usdt.usd)}`
                    : null,
                ].filter(Boolean) as string[];
                try {
                  await navigator.clipboard.writeText(lines.join("\n"));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {}
              }}
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              {copied ? "تم النسخ ✓" : "نسخ النتيجة"}
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-4">
            <div className="rounded-lg bg-slate-50 p-2 text-center">
              <div className="font-bold text-slate-700">TON</div>
              <div dir="ltr">${formatNum(rates.ton.usd)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2 text-center">
              <div className="font-bold text-slate-700">BTC</div>
              <div dir="ltr">${formatNum(rates.btc.usd)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2 text-center">
              <div className="font-bold text-slate-700">ETH</div>
              <div dir="ltr">${formatNum(rates.eth.usd)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-2 text-center">
              <div className="font-bold text-slate-700">USDT</div>
              <div dir="ltr">${formatNum(rates.usdt.usd)}</div>
            </div>
          </div>

          <p className="text-[11px] text-slate-400 text-center">
            الأسعار من CoinGecko (مجانية) — تقريبية وقد تتأخر ثوانٍ. ليست نصيحة استثمارية.
            <br />
            محفظة TON مدمجة في بوتات الإعلانات على سوق تولز.
          </p>

          <button
            type="button"
            onClick={load}
            className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            تحديث الأسعار
          </button>
        </>
      )}
    </div>
  );
}
