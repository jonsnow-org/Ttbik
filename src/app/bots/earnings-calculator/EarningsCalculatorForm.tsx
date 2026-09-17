"use client";

import { useMemo, useState } from "react";
import SectionBackdrop from "@/components/SectionBackdrop";

export default function EarningsCalculatorForm() {
  const [subscribers, setSubscribers] = useState("5000");
  const [avgViews, setAvgViews] = useState("2000");
  const [postsPerMonth, setPostsPerMonth] = useState("20");
  const [cpm, setCpm] = useState("2.5");
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => {
    const s = Number(subscribers) || 0;
    const v = Number(avgViews) || 0;
    const p = Number(postsPerMonth) || 0;
    const c = Number(cpm) || 0;
    const monthlyViews = v * p;
    const monthlyUsd = (monthlyViews / 1000) * c;
    const yearlyUsd = monthlyUsd * 12;
    const reachPct = s > 0 ? Math.min(100, (v / s) * 100) : 0;
    return { monthlyViews, monthlyUsd, yearlyUsd, reachPct, subscribers: s };
  }, [subscribers, avgViews, postsPerMonth, cpm]);

  async function copySummary() {
    const text = [
      "تقدير أرباح قناة تليجرام — سوق تولز",
      `المشتركون: ${result.subscribers.toLocaleString("ar")}`,
      `متوسط المشاهدات/منشور: ${(Number(avgViews) || 0).toLocaleString("ar")}`,
      `نسبة الوصول التقريبية: ${result.reachPct.toFixed(1)}%`,
      `المنشورات/شهر: ${postsPerMonth}`,
      `CPM: $${Number(cpm) || 0}`,
      `مشاهدات إعلانية شهرية: ${result.monthlyViews.toLocaleString("ar")}`,
      `تقدير شهري: $${result.monthlyUsd.toFixed(2)}`,
      `تقدير سنوي: $${result.yearlyUsd.toFixed(2)}`,
      "الأرقام تقريبية للتخطيط وليست وعداً بربح.",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="relative mx-auto max-w-lg px-4 py-10">
      <SectionBackdrop tone="bots" />
      <span className="mx-auto mb-3 block w-fit rounded-full bg-indigo-50 px-4 py-1.5 text-xs font-bold text-indigo-700">
        📊 حاسبة أرباح تليجرام
      </span>
      <h1 className="mb-2 text-2xl font-extrabold text-slate-900">حاسبة أرباح قناة أو بوت تليجرام</h1>
      <p className="mb-6 text-sm text-slate-600">
        قدّر أرباحك الشهرية والتقريبية السنوية من الإعلانات بناءً على مشاهداتك الحقيقية — أرقام تقريبية للتخطيط، وليست وعداً
        بربح مضمون (يختلف السعر الفعلي حسب المعلن والمنافذ الإعلانية).
      </p>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">عدد المشتركين الحاليين</label>
          <input
            type="number"
            min="0"
            value={subscribers}
            onChange={(e) => setSubscribers(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <p className="mt-1 text-xs text-slate-500">يُستخدم لحساب نسبة الوصول (المشاهدات ÷ المشتركين).</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">متوسط المشاهدات لكل منشور</label>
          <input
            type="number"
            min="0"
            value={avgViews}
            onChange={(e) => setAvgViews(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">عدد المنشورات الإعلانية شهرياً</label>
          <input
            type="number"
            min="0"
            value={postsPerMonth}
            onChange={(e) => setPostsPerMonth(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            السعر التقريبي لكل 1000 مشاهدة (CPM بالدولار)
          </label>
          <input
            type="number"
            min="0"
            step="0.1"
            value={cpm}
            onChange={(e) => setCpm(e.target.value)}
            className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <p className="mt-1 text-xs text-slate-500">
            القنوات العربية العامة غالباً بين 1-4$ لكل 1000 مشاهدة — عدّل الرقم حسب سعر السوق الفعلي في مجالك.
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 p-6 text-white shadow-md">
        <p className="text-sm text-indigo-100">نسبة الوصول التقريبية من المشتركين</p>
        <p className="text-2xl font-extrabold">{result.reachPct.toFixed(1)}%</p>
        <p className="mt-3 text-sm text-indigo-100">إجمالي المشاهدات الإعلانية شهرياً</p>
        <p className="text-2xl font-extrabold">{result.monthlyViews.toLocaleString("ar")}</p>
        <p className="mt-3 text-sm text-indigo-100">الأرباح الشهرية التقريبية</p>
        <p className="text-3xl font-extrabold">${result.monthlyUsd.toFixed(2)}</p>
        <p className="mt-3 text-sm text-indigo-100">التقدير السنوي التقريبي</p>
        <p className="text-2xl font-extrabold">${result.yearlyUsd.toFixed(2)}</p>
        <button
          type="button"
          onClick={copySummary}
          className="mt-4 w-full rounded-xl bg-white/15 py-2 text-sm font-bold text-white hover:bg-white/25"
        >
          {copied ? "تم النسخ ✓" : "نسخ ملخص التقدير"}
        </button>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        💡 تريد ربحاً حقيقياً فورياً بدل الانتظار لبيع إعلانات بنفسك؟ شغّل بوت الإعلانات والمهام مجاناً على قناتك من{" "}
        <a href="/watch-and-earn" className="font-bold text-indigo-700 underline">
          هنا
        </a>
        .
      </p>
    </main>
  );
}
