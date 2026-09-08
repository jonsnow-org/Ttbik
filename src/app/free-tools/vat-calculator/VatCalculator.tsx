"use client";

import { useMemo, useState } from "react";

const PRESETS: { label: string; rate: number }[] = [
  { label: "السعودية 15%", rate: 15 },
  { label: "الإمارات / البحرين 5%", rate: 5 },
  { label: "مصر 14%", rate: 14 },
  { label: "الأردن 16%", rate: 16 },
  { label: "عُمان 5%", rate: 5 },
  { label: "مخصص", rate: -1 },
];

function parseNum(v: string): number {
  const n = parseFloat(v.replace(/,/g, "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("ar-SA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export default function VatCalculator() {
  const [mode, setMode] = useState<"ex" | "inc">("ex"); // exclusive or inclusive
  const [amount, setAmount] = useState("100");
  const [presetIdx, setPresetIdx] = useState(0);
  const [customRate, setCustomRate] = useState("15");

  const rate =
    PRESETS[presetIdx].rate >= 0
      ? PRESETS[presetIdx].rate
      : parseNum(customRate);

  const result = useMemo(() => {
    const a = parseNum(amount);
    if (a < 0 || rate < 0) return null;
    const r = rate / 100;
    if (mode === "ex") {
      const vat = a * r;
      const total = a + vat;
      return { base: a, vat, total };
    } else {
      const base = a / (1 + r);
      const vat = a - base;
      return { base, vat, total: a };
    }
  }, [amount, rate, mode]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
      <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setMode("ex")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
            mode === "ex"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500"
          }`}
        >
          المبلغ قبل الضريبة
        </button>
        <button
          type="button"
          onClick={() => setMode("inc")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
            mode === "inc"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500"
          }`}
        >
          المبلغ شامل الضريبة
        </button>
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold text-slate-700">
          {mode === "ex" ? "المبلغ قبل الضريبة" : "المبلغ شامل الضريبة"}
        </label>
        <input
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          dir="ltr"
          className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
          placeholder="مثال: 100"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-semibold text-slate-700">
          نسبة الضريبة
        </label>
        <div className="flex flex-wrap gap-2 mb-2">
          {PRESETS.map((p, i) => (
            <button
              key={p.label}
              type="button"
              onClick={() => setPresetIdx(i)}
              className={`rounded-full px-3 py-1 text-xs font-medium border transition ${
                presetIdx === i
                  ? "bg-brand-50 border-brand-300 text-brand-800"
                  : "bg-white border-slate-200 text-slate-600 hover:border-slate-300"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {PRESETS[presetIdx].rate < 0 && (
          <input
            value={customRate}
            onChange={(e) => setCustomRate(e.target.value)}
            inputMode="decimal"
            dir="ltr"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
            placeholder="نسبة مخصصة %"
          />
        )}
      </div>

      {result && (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">المبلغ قبل الضريبة</span>
            <span className="font-bold text-slate-900" dir="ltr">
              {fmt(result.base)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">مبلغ الضريبة ({fmt(rate, 1)}%)</span>
            <span className="font-bold text-slate-900" dir="ltr">
              {fmt(result.vat)}
            </span>
          </div>
          <div className="flex justify-between text-sm border-t border-slate-200 pt-2">
            <span className="text-slate-700 font-semibold">الإجمالي شامل الضريبة</span>
            <span className="font-extrabold text-emerald-700 text-lg" dir="ltr">
              {fmt(result.total)}
            </span>
          </div>
          <button
            type="button"
            onClick={async () => {
              const text = [
                `المبلغ قبل الضريبة: ${fmt(result.base)}`,
                `مبلغ الضريبة (${fmt(rate, 1)}%): ${fmt(result.vat)}`,
                `الإجمالي شامل الضريبة: ${fmt(result.total)}`,
              ].join("\n");
              try {
                await navigator.clipboard.writeText(text);
              } catch {
                /* ignore */
              }
            }}
            className="mt-2 w-full rounded-lg border border-slate-300 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
          >
            نسخ النتيجة
          </button>
        </div>
      )}

      <p className="text-[11px] text-slate-400 text-center leading-relaxed">
        حاسبة تقريبية لأصحاب الأعمال والمستقلين في الدول العربية. لا تغني عن استشارة محاسب.
        <br />
        تعمل بالكامل داخل المتصفح — بلا تسجيل وبلا تخزين.
      </p>
    </div>
  );
}
