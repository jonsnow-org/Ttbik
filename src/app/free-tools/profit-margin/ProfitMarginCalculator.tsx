"use client";

import { useMemo, useState } from "react";

function parseNum(v: string): number {
  const n = parseFloat(v.replace(/,/g, "").replace(/[^ء-يd0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("ar-SA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export default function ProfitMarginCalculator() {
  const [cost, setCost] = useState("50");
  const [price, setPrice] = useState("100");
  const [fixed, setFixed] = useState("");
  const [qty, setQty] = useState("");
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => {
    const c = parseNum(cost);
    const p = parseNum(price);
    const f = parseNum(fixed);
    const q = parseNum(qty);

    if (c < 0 || p < 0) {
      return null;
    }

    const unitProfit = p - c;
    const marginPct = p > 0 ? (unitProfit / p) * 100 : 0;
    const markupPct = c > 0 ? (unitProfit / c) * 100 : 0;
    const breakEvenUnits =
      unitProfit > 0 && f > 0 ? f / unitProfit : unitProfit > 0 && f === 0 ? 0 : null;
    const expectedProfit =
      q > 0 && unitProfit !== 0 ? unitProfit * q - f : null;

    return {
      unitProfit,
      marginPct,
      markupPct,
      breakEvenUnits,
      expectedProfit,
      hasFixed: f > 0,
      hasQty: q > 0,
    };
  }, [cost, price, fixed, qty]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">
            تكلفة الوحدة
          </label>
          <input
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            inputMode="decimal"
            dir="ltr"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
            placeholder="مثال: 50"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">
            سعر البيع
          </label>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            dir="ltr"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
            placeholder="مثال: 100"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">
            تكاليف ثابتة (اختياري)
          </label>
          <input
            value={fixed}
            onChange={(e) => setFixed(e.target.value)}
            inputMode="decimal"
            dir="ltr"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
            placeholder="إيجار، رواتب…"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">
            كمية متوقعة (اختياري)
          </label>
          <input
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            inputMode="decimal"
            dir="ltr"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
            placeholder="عدد الوحدات"
          />
        </div>
      </div>

      {result && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-brand-100 bg-brand-50/70 p-4 text-center">
              <p className="text-xs text-slate-500 mb-1">هامش الربح</p>
              <p className="text-2xl font-extrabold text-slate-900">
                {fmt(result.marginPct, 1)}%
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                (ربح الوحدة ÷ سعر البيع)
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
              <p className="text-xs text-slate-500 mb-1">نسبة الإضافة (Markup)</p>
              <p className="text-2xl font-extrabold text-slate-900">
                {fmt(result.markupPct, 1)}%
              </p>
              <p className="text-[11px] text-slate-400 mt-1">
                (ربح الوحدة ÷ التكلفة)
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">ربح الوحدة</span>
              <span className="font-bold text-slate-900" dir="ltr">
                {fmt(result.unitProfit)}
              </span>
            </div>
            {result.hasFixed && (
              <div className="mt-2 flex justify-between text-sm border-t border-slate-100 pt-2">
                <span className="text-slate-600">نقطة التعادل (وحدات)</span>
                <span className="font-bold text-slate-900" dir="ltr">
                  {result.breakEvenUnits === null
                    ? "غير ممكن (ربح ≤ 0)"
                    : fmt(result.breakEvenUnits, 1)}
                </span>
              </div>
            )}
            {result.hasQty && result.expectedProfit !== null && (
              <div className="mt-2 flex justify-between text-sm border-t border-slate-100 pt-2">
                <span className="text-slate-600">الربح المتوقع</span>
                <span
                  className={`font-bold ${result.expectedProfit >= 0 ? "text-emerald-700" : "text-red-600"}`}
                  dir="ltr"
                >
                  {fmt(result.expectedProfit)}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={async () => {
                const lines = [
                  `هامش الربح: ${fmt(result.marginPct, 1)}%`,
                  `نسبة الإضافة (Markup): ${fmt(result.markupPct, 1)}%`,
                  `ربح الوحدة: ${fmt(result.unitProfit)}`,
                ];
                if (result.hasFixed) {
                  lines.push(
                    `نقطة التعادل (وحدات): ${
                      result.breakEvenUnits === null
                        ? "غير ممكن"
                        : fmt(result.breakEvenUnits, 1)
                    }`
                  );
                }
                if (result.hasQty && result.expectedProfit !== null) {
                  lines.push(`الربح المتوقع: ${fmt(result.expectedProfit)}`);
                }
                try {
                  await navigator.clipboard.writeText(lines.join("\n"));
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  /* ignore */
                }
              }}
              className="mt-3 w-full rounded-lg border border-slate-300 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
            >
              {copied ? "تم النسخ ✓" : "نسخ النتيجة"}
            </button>
          </div>

          {result.unitProfit <= 0 && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">
              سعر البيع أقل من أو يساوي التكلفة — لا يوجد هامش ربح إيجابي.
            </p>
          )}
        </div>
      )}

      <p className="text-[11px] text-slate-400 text-center leading-relaxed">
        حاسبة بسيطة للمتاجر والمستقلين. النتائج تقريبية ولا تغني عن محاسبة مهنية.
        <br />
        تعمل بالكامل داخل المتصفح — بلا تسجيل وبلا تخزين.
      </p>
    </div>
  );
}
