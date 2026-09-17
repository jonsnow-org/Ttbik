"use client";

import { useMemo, useState } from "react";

function parseNum(v: string): number {
  const n = parseFloat(v.replace(/,/g, "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("ar-SA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

function category(bmi: number): { label: string; color: string; tip: string } {
  if (bmi < 18.5)
    return {
      label: "نحافة",
      color: "text-sky-700 bg-sky-50",
      tip: "قد تحتاج زيادة سعرات أو مراجعة طبية.",
    };
  if (bmi < 25)
    return {
      label: "وزن طبيعي",
      color: "text-emerald-700 bg-emerald-50",
      tip: "حافظ على نمط حياة متوازن.",
    };
  if (bmi < 30)
    return {
      label: "زيادة وزن",
      color: "text-amber-700 bg-amber-50",
      tip: "قلل السعرات وزد النشاط البدني تدريجياً.",
    };
  return {
    label: "سمنة",
    color: "text-rose-700 bg-rose-50",
    tip: "يُفضّل استشارة مختص تغذية أو طبيب.",
  };
}

/** Ideal weight range (Devine formula approximation, adult). */
function idealRange(heightCm: number, isMale: boolean): { min: number; max: number } | null {
  if (heightCm < 140 || heightCm > 220) return null;
  const inches = heightCm / 2.54;
  const base = isMale ? 50 + 2.3 * (inches - 60) : 45.5 + 2.3 * (inches - 60);
  // ±10% as practical healthy band
  return { min: Math.round(base * 0.9), max: Math.round(base * 1.1) };
}

export default function BmiCalculator() {
  const [height, setHeight] = useState("170");
  const [weight, setWeight] = useState("70");
  const [sex, setSex] = useState<"m" | "f">("m");
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => {
    const h = parseNum(height);
    const w = parseNum(weight);
    if (h < 100 || h > 250 || w < 20 || w > 300) return null;
    const m = h / 100;
    const bmi = w / (m * m);
    const cat = category(bmi);
    const ideal = idealRange(h, sex === "m");
    return { bmi, cat, ideal };
  }, [height, weight, sex]);

  async function copySummary() {
    if (!result) return;
    const lines = [
      `مؤشر كتلة الجسم (BMI): ${fmt(result.bmi, 1)}`,
      `التصنيف: ${result.cat.label}`,
      result.ideal
        ? `الوزن المثالي التقريبي: ${result.ideal.min} – ${result.ideal.max} كغ`
        : "",
      "حاسبة سوق تولز — مجانية بلا تسجيل",
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-slate-700">الطول (سم)</span>
          <input
            type="number"
            inputMode="decimal"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            placeholder="170"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-semibold text-slate-700">الوزن (كغ)</span>
          <input
            type="number"
            inputMode="decimal"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-100"
            placeholder="70"
          />
        </label>
      </div>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => setSex("m")}
          className={`flex-1 rounded-xl px-3 py-2 text-sm font-bold transition ${
            sex === "m"
              ? "bg-brand-600 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          ذكر
        </button>
        <button
          type="button"
          onClick={() => setSex("f")}
          className={`flex-1 rounded-xl px-3 py-2 text-sm font-bold transition ${
            sex === "f"
              ? "bg-brand-600 text-white"
              : "bg-slate-100 text-slate-600 hover:bg-slate-200"
          }`}
        >
          أنثى
        </button>
      </div>

      {result && (
        <div className="mt-6 space-y-3">
          <div className="rounded-xl bg-slate-50 p-4 text-center">
            <p className="text-xs font-semibold text-slate-500">مؤشر كتلة الجسم (BMI)</p>
            <p className="mt-1 text-3xl font-extrabold text-slate-900">{fmt(result.bmi, 1)}</p>
            <span
              className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-bold ${result.cat.color}`}
            >
              {result.cat.label}
            </span>
            <p className="mt-2 text-sm text-slate-600">{result.cat.tip}</p>
          </div>

          {result.ideal && (
            <div className="rounded-xl border border-slate-100 p-4">
              <p className="text-sm font-semibold text-slate-700">الوزن المثالي التقريبي</p>
              <p className="mt-1 text-lg font-extrabold text-brand-700">
                {result.ideal.min} – {result.ideal.max} كغ
              </p>
              <p className="mt-1 text-xs text-slate-500">
                تقدير مبني على معادلة شائعة (Devine) للبالغين — ليس تشخيصاً طبياً.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={copySummary}
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
          >
            {copied ? "تم النسخ ✓" : "نسخ الملخص"}
          </button>
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-slate-400">
        الأداة تعليمية فقط وليست بديلاً عن استشارة طبية. مؤشر كتلة الجسم لا يأخذ في
        الاعتبار كتلة العضلات أو توزيع الدهون.
      </p>
    </div>
  );
}
