"use client";

import { useMemo, useState } from "react";
import SectionBackdrop from "@/components/SectionBackdrop";

const CPM_PRESETS = [
  { label: "1$", value: "1" },
  { label: "2.5$", value: "2.5" },
  { label: "4$", value: "4" },
];

const FILL_PRESETS = [
  { label: "25%", value: "25" },
  { label: "40%", value: "40" },
  { label: "70%", value: "70" },
  { label: "100%", value: "100" },
];

const POSTS_PRESETS = [
  { label: "8/شهر", value: "8" },
  { label: "12/شهر", value: "12" },
  { label: "20/شهر", value: "20" },
  { label: "30/شهر", value: "30" },
];

const SUB_PRESETS = [
  { label: "1 ألف", value: "1000" },
  { label: "5 آلاف", value: "5000" },
  { label: "10 آلاف", value: "10000" },
  { label: "25 ألف", value: "25000" },
  { label: "50 ألف", value: "50000" },
  { label: "100 ألف", value: "100000" },
  { label: "250 ألف", value: "250000" },
  { label: "500 ألف", value: "500000" },
  { label: "مليون", value: "1000000" },
  { label: "مليونان", value: "2000000" },
  { label: "5 ملايين", value: "5000000" },
];

const VIEW_PRESETS = [
  { label: "500", value: "500" },
  { label: "1 ألف", value: "1000" },
  { label: "2 ألف", value: "2000" },
  { label: "5 آلاف", value: "5000" },
];

const TARGET_PRESETS = [
  { label: "50$", value: "50" },
  { label: "100$", value: "100" },
  { label: "250$", value: "250" },
  { label: "500$", value: "500" },
  { label: "1000$", value: "1000" },
];

export default function EarningsCalculatorForm() {
  const [subscribers, setSubscribers] = useState("5000");
  const [avgViews, setAvgViews] = useState("2000");
  const [postsPerMonth, setPostsPerMonth] = useState("20");
  const [cpm, setCpm] = useState("2.5");
  const [fillRate, setFillRate] = useState("40");
  const [targetMonthly, setTargetMonthly] = useState("100");
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => {
    const s = Number(subscribers) || 0;
    const v = Number(avgViews) || 0;
    const p = Number(postsPerMonth) || 0;
    const c = Number(cpm) || 0;
    const fill = Math.min(100, Math.max(0, Number(fillRate) || 0));
    const target = Math.max(0, Number(targetMonthly) || 0);
    const monthlyViews = v * p;
    const soldViews = monthlyViews * (fill / 100);
    const monthlyUsd = (soldViews / 1000) * c;
    const yearlyUsd = monthlyUsd * 12;
    const quarterlyUsd = monthlyUsd * 3;
    const dailyUsd = monthlyUsd / 30;
    const weeklyUsd = monthlyUsd / 4.345;
    const perAdUsd = p > 0 ? monthlyUsd / p : 0;
    const perSubUsd = s > 0 ? monthlyUsd / s : 0;
    const perSubYearlyUsd = perSubUsd * 12;
    const reachPct = s > 0 ? Math.min(100, (v / s) * 100) : 0;
    const viewsExceedSubs = s > 0 && v > s;
    const requiredCpm = soldViews > 0 ? (target / soldViews) * 1000 : 0;
    const gapUsd = target - monthlyUsd;
    const revenuePerPost = v > 0 && c > 0 ? (v * (fill / 100) / 1000) * c : 0;
    const requiredPosts = revenuePerPost > 0 ? target / revenuePerPost : 0;
    const fullFillMonthly = (monthlyViews / 1000) * c;
    const requiredFill = fullFillMonthly > 0 ? Math.min(999, (target / fullFillMonthly) * 100) : 0;
    const denomViews = p > 0 && c > 0 && fill > 0 ? (p * (fill / 100) * c) / 1000 : 0;
    const requiredViews = denomViews > 0 ? target / denomViews : 0;
    const requiredReachPct = s > 0 && requiredViews > 0 ? (requiredViews / s) * 100 : 0;
    const requiredSubscribers = v > 0 && s > 0 && requiredViews > 0 ? (requiredViews * s) / v : 0;
    const monthsToTarget = monthlyUsd > 0 ? target / monthlyUsd : 0;
    const weeksToTarget = monthsToTarget * 4.345;
    const daysToTarget = monthsToTarget * 30;
    const hoursToTarget = daysToTarget * 24;
    const minutesToTarget = hoursToTarget * 60;
    const secondsToTarget = minutesToTarget * 60;
    const yearsToTarget = monthsToTarget / 12;
    return {
      monthlyViews,
      soldViews,
      monthlyUsd,
      yearlyUsd,
      quarterlyUsd,
      dailyUsd,
      weeklyUsd,
      perAdUsd,
      perSubUsd,
      perSubYearlyUsd,
      reachPct,
      subscribers: s,
      viewsExceedSubs,
      fill,
      target,
      requiredCpm,
      gapUsd,
      requiredPosts,
      requiredFill,
      requiredViews,
      requiredReachPct,
      requiredSubscribers,
      monthsToTarget,
      weeksToTarget,
      daysToTarget,
      hoursToTarget,
      minutesToTarget,
      secondsToTarget,
      yearsToTarget,
    };
  }, [subscribers, avgViews, postsPerMonth, cpm, fillRate, targetMonthly]);

  async function copySummary() {
    const text = [
      "تقدير أرباح قناة تليجرام — سوق تولز",
      `المشتركون: ${result.subscribers.toLocaleString("ar")}`,
      `متوسط المشاهدات/منشور: ${(Number(avgViews) || 0).toLocaleString("ar")}`,
      `نسبة الوصول التقريبية: ${result.reachPct.toFixed(1)}%`,
      `المنشورات/شهر: ${postsPerMonth}`,
      `CPM: $${Number(cpm) || 0}`,
      `نسبة بيع المساحات: ${result.fill}%`,
      `مشاهدات كلية شهرياً: ${result.monthlyViews.toLocaleString("ar")}`,
      `مشاهدات مبيعة تقريباً: ${Math.round(result.soldViews).toLocaleString("ar")}`,
      `تقدير لكل منشور إعلاني: $${result.perAdUsd.toFixed(2)}`,
      `تقدير لكل مشترك/شهر: $${result.perSubUsd.toFixed(4)}`,
      `تقدير لكل مشترك/سنة: $${result.perSubYearlyUsd.toFixed(4)}`,
      `هدف شهري: $${result.target.toFixed(2)}`,
      `CPM مطلوب للهدف: $${result.requiredCpm.toFixed(2)}`,
      `منشورات مطلوبة للهدف: ${result.requiredPosts.toFixed(1)}`,
      `نسبة بيع مطلوبة للهدف: ${result.requiredFill.toFixed(0)}%`,
      `مشاهدات/منشور مطلوبة للهدف: ${Math.round(result.requiredViews).toLocaleString("ar")}`,
      `نسبة وصول مطلوبة للهدف: ${result.requiredReachPct.toFixed(1)}%`,
      `مشتركون مطلوبون للهدف بنفس نسبة الوصول: ${Math.round(result.requiredSubscribers).toLocaleString("ar")}`,
      `أشهر لتغطية الهدف بنفس الوتيرة: ${result.monthsToTarget.toFixed(1)}`,
      `أسابيع لتغطية الهدف بنفس الوتيرة: ${result.weeksToTarget.toFixed(1)}`,
      `أيام لتغطية الهدف بنفس الوتيرة: ${result.daysToTarget.toFixed(0)}`,
      `ساعات لتغطية الهدف بنفس الوتيرة: ${result.hoursToTarget.toFixed(0)}`,
      `دقائق لتغطية الهدف بنفس الوتيرة: ${result.minutesToTarget.toFixed(0)}`,
      `ثوانٍ لتغطية الهدف بنفس الوتيرة: ${result.secondsToTarget.toFixed(0)}`,
      `سنوات لتغطية الهدف بنفس الوتيرة: ${result.yearsToTarget.toFixed(2)}`,
      `الفجوة مقابل الهدف: $${result.gapUsd.toFixed(2)}`,
      `تقدير يومي: $${result.dailyUsd.toFixed(2)}`,
      `تقدير أسبوعي: $${result.weeklyUsd.toFixed(2)}`,
      `تقدير شهري: $${result.monthlyUsd.toFixed(2)}`,
      `تقدير ربع سنوي: $${result.quarterlyUsd.toFixed(2)}`,
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
        قدّر أرباحك الشهرية والتقريبية السنوية من الإعلانات بناءً على مشاهداتك ونسبة المساحات المبيعة — أرقام تقريبية للتخطيط، وليست وعداً
        بربح مضمون (يختلف السعر الفعلي حسب المعلن والمنافذ الإعلانية).
      </p>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">عدد المشتركين الحاليين</label>
          <input type="number" min="0" value={subscribers} onChange={(e) => setSubscribers(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          <div className="mt-2 flex flex-wrap gap-2">
            {SUB_PRESETS.map((preset) => (
              <button key={preset.value} type="button" onClick={() => setSubscribers(preset.value)} className={`rounded-full px-3 py-1 text-xs font-bold ${
                  subscribers === preset.value ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}>{preset.label}</button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">يُستخدم لحساب نسبة الوصول (المشاهدات ÷ المشتركين) والربح لكل مشترك.</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">متوسط المشاهدات لكل منشور</label>
          <input type="number" min="0" value={avgViews} onChange={(e) => setAvgViews(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          <div className="mt-2 flex flex-wrap gap-2">
            {VIEW_PRESETS.map((preset) => (
              <button key={preset.value} type="button" onClick={() => setAvgViews(preset.value)} className={`rounded-full px-3 py-1 text-xs font-bold ${
                  avgViews === preset.value ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}>{preset.label}</button>
            ))}
          </div>
          {result.viewsExceedSubs ? (
            <p className="mt-1 text-xs text-amber-700">المشاهدات أعلى من عدد المشتركين — ممكن للمشاركات/الإعادات، ونسبة الوصول مسقوفة عند 100%.</p>
          ) : (
            <p className="mt-1 text-xs text-slate-500">معظم القنوات العربية تصل 20–40% من المشتركين لكل منشور — عدّل رقمك من إحصائيات القناة.</p>
          )}
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">عدد المنشورات الإعلانية شهرياً</label>
          <input type="number" min="0" value={postsPerMonth} onChange={(e) => setPostsPerMonth(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          <div className="mt-2 flex flex-wrap gap-2">
            {POSTS_PRESETS.map((preset) => (
              <button key={preset.value} type="button" onClick={() => setPostsPerMonth(preset.value)} className={`rounded-full px-3 py-1 text-xs font-bold ${
                  postsPerMonth === preset.value ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}>{preset.label}</button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">8–12 مناسب لقناة هادئة، 20 لقناة نشطة، 30 إذا كان النشر يومياً تقريباً.</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">السعر التقريبي لكل 1000 مشاهدة (CPM بالدولار)</label>
          <input type="number" min="0" step="0.1" value={cpm} onChange={(e) => setCpm(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          <div className="mt-2 flex flex-wrap gap-2">
            {CPM_PRESETS.map((preset) => (
              <button key={preset.value} type="button" onClick={() => setCpm(preset.value)} className={`rounded-full px-3 py-1 text-xs font-bold ${
                  cpm === preset.value ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}>{preset.label}</button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">القنوات العربية العامة غالباً بين 1-4$ لكل 1000 مشاهدة — عدّل الرقم حسب سعر السوق الفعلي في مجالك.</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">نسبة بيع المساحات الإعلانية (fill rate)</label>
          <input type="number" min="0" max="100" step="1" value={fillRate} onChange={(e) => setFillRate(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          <div className="mt-2 flex flex-wrap gap-2">
            {FILL_PRESETS.map((preset) => (
              <button key={preset.value} type="button" onClick={() => setFillRate(preset.value)} className={`rounded-full px-3 py-1 text-xs font-bold ${
                  fillRate === preset.value ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}>{preset.label}</button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">معظم القنوات لا تبيع كل منشور. 40% افتراض واقعي لقناة متوسطة — 100% يعني كل المشاهدات مبيعة.</p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">هدف الربح الشهري بالدولار</label>
          <input type="number" min="0" step="1" value={targetMonthly} onChange={(e) => setTargetMonthly(e.target.value)} className="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500" />
          <div className="mt-2 flex flex-wrap gap-2">
            {TARGET_PRESETS.map((preset) => (
              <button key={preset.value} type="button" onClick={() => setTargetMonthly(preset.value)} className={`rounded-full px-3 py-1 text-xs font-bold ${
                  targetMonthly === preset.value ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}>{preset.label}</button>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-500">نحسب CPM المطلوب، وعدد المنشورات، ونسبة البيع، والمشاهدات المطلوبة للوصول لهذا الرقم — كل سيناريو يثبّت باقي المدخلات.</p>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 p-6 text-white shadow-md">
        <p className="text-sm text-indigo-100">نسبة الوصول التقريبية من المشتركين</p>
        <p className="text-2xl font-extrabold">{result.reachPct.toFixed(1)}%</p>
        <p className="mt-3 text-sm text-indigo-100">مشاهدات كلية / مبيعة شهرياً</p>
        <p className="text-2xl font-extrabold">
          {result.monthlyViews.toLocaleString("ar")}{" "}
          <span className="text-base font-bold text-indigo-100">/ {Math.round(result.soldViews).toLocaleString("ar")}</span>
        </p>
        <p className="mt-3 text-sm text-indigo-100">تقدير لكل منشور إعلاني (بعد fill rate)</p>
        <p className="text-2xl font-extrabold">${result.perAdUsd.toFixed(2)}</p>
        <p className="mt-3 text-sm text-indigo-100">تقدير شهري لكل مشترك (ARPU)</p>
        <p className="text-2xl font-extrabold">${result.perSubUsd.toFixed(4)}</p>
        <p className="mt-3 text-sm text-indigo-100">تقدير سنوي لكل مشترك</p>
        <p className="text-2xl font-extrabold">${result.perSubYearlyUsd.toFixed(4)}</p>
        <p className="mt-3 text-sm text-indigo-100">CPM مطلوب لهدف ${result.target.toFixed(0)}/شهر</p>
        <p className="text-2xl font-extrabold">${result.requiredCpm.toFixed(2)}</p>
        <p className="mt-3 text-sm text-indigo-100">منشورات/شهر مطلوبة لنفس الهدف (نفس CPM والمشاهدات والبيع)</p>
        <p className="text-2xl font-extrabold">{result.requiredPosts.toFixed(1)}</p>
        <p className="mt-3 text-sm text-indigo-100">نسبة بيع مطلوبة لنفس الهدف (نفس المشاهدات وCPM)</p>
        <p className="text-2xl font-extrabold">{result.requiredFill.toFixed(0)}%</p>
        <p className="mt-3 text-sm text-indigo-100">مشاهدات/منشور مطلوبة لنفس الهدف (نفس عدد المنشورات وCPM والبيع)</p>
        <p className="text-2xl font-extrabold">{Math.round(result.requiredViews).toLocaleString("ar")}</p>
        <p className="mt-1 text-xs text-indigo-100">
          نسبة وصول مطلوبة من المشتركين الحاليين: {result.requiredReachPct.toFixed(1)}%
          {result.requiredReachPct > 100 ? " — أعلى من 100% وصول عضوية؛ الهدف يحتاج نمو مشتركين أو رفع CPM/المنشورات." : ""}
        </p>
        <p className="mt-3 text-sm text-indigo-100">مشتركون مطلوبون لنفس الهدف (بنفس نسبة الوصول الحالية)</p>
        <p className="text-2xl font-extrabold">{Math.round(result.requiredSubscribers).toLocaleString("ar")}</p>
        <p className="mt-3 text-sm text-indigo-100">أشهر لتغطية الهدف بنفس الوتيرة الحالية</p>
        <p className="text-2xl font-extrabold">{result.monthsToTarget.toFixed(1)}</p>
        <p className="mt-3 text-sm text-indigo-100">أسابيع لتغطية الهدف بنفس الوتيرة الحالية</p>
        <p className="text-2xl font-extrabold">{result.weeksToTarget.toFixed(1)}</p>
        <p className="mt-3 text-sm text-indigo-100">أيام لتغطية الهدف بنفس الوتيرة الحالية</p>
        <p className="text-2xl font-extrabold">{result.daysToTarget.toFixed(0)}</p>
        <p className="mt-3 text-sm text-indigo-100">ساعات لتغطية الهدف بنفس الوتيرة الحالية</p>
        <p className="text-2xl font-extrabold">{result.hoursToTarget.toFixed(0)}</p>
        <p className="mt-3 text-sm text-indigo-100">دقائق لتغطية الهدف بنفس الوتيرة الحالية</p>
        <p className="text-2xl font-extrabold">{result.minutesToTarget.toFixed(0)}</p>
        <p className="mt-3 text-sm text-indigo-100">ثوانٍ لتغطية الهدف بنفس الوتيرة الحالية</p>
        <p className="text-2xl font-extrabold">{result.secondsToTarget.toFixed(0)}</p>
        <p className="mt-3 text-sm text-indigo-100">سنوات لتغطية الهدف بنفس الوتيرة الحالية</p>
        <p className="text-2xl font-extrabold">{result.yearsToTarget.toFixed(2)}</p>
        <p className="mt-1 text-xs text-indigo-100">
          {result.monthlyUsd <= 0
            ? "لا يوجد تقدير شهري حالياً — ارفع المشاهدات أو البيع أو الـ CPM."
            : result.monthsToTarget <= 1
              ? "الوتيرة الحالية تغطي الهدف خلال شهر أو أقل."
              : result.monthsToTarget > 24
                ? "أكثر من سنتين بنفس الوتيرة — الهدف يحتاج رفع CPM أو الوصول أو عدد المنشورات."
                : `بنفس الأرقام الحالية تحتاج نحو ${result.monthsToTarget.toFixed(1)} شهر لتراكم مبلغ الهدف.`}
        </p>
        <p className="mt-1 text-xs text-indigo-100">
          {result.requiredFill > 100
            ? "حتى مع بيع 100% المشاهدات الحالية لا تكفي الهدف — زد المنشورات أو المشاهدات أو الـ CPM."
            : result.gapUsd <= 0
              ? "التقدير الحالي يغطي الهدف أو يتجاوزه."
              : `ينقص تقريباً $${result.gapUsd.toFixed(2)} عن الهدف بهذا الـ CPM.`}
        </p>
        <p className="mt-3 text-sm text-indigo-100">الأرباح اليومية التقريبية</p>
        <p className="text-2xl font-extrabold">${result.dailyUsd.toFixed(2)}</p>
        <p className="mt-3 text-sm text-indigo-100">الأرباح الأسبوعية التقريبية</p>
        <p className="text-2xl font-extrabold">${result.weeklyUsd.toFixed(2)}</p>
        <p className="mt-3 text-sm text-indigo-100">الأرباح الشهرية التقريبية</p>
        <p className="text-3xl font-extrabold">${result.monthlyUsd.toFixed(2)}</p>
        <p className="mt-3 text-sm text-indigo-100">التقدير الربعي التقريبي</p>
        <p className="text-2xl font-extrabold">${result.quarterlyUsd.toFixed(2)}</p>
        <p className="mt-3 text-sm text-indigo-100">التقدير السنوي التقريبي</p>
        <p className="text-2xl font-extrabold">${result.yearlyUsd.toFixed(2)}</p>
        <button type="button" onClick={copySummary} className="mt-4 w-full rounded-xl bg-white/15 py-2 text-sm font-bold text-white hover:bg-white/25">
          {copied ? "تم النسخ ✓" : "نسخ ملخص التقدير"}
        </button>
      </div>

      <p className="mt-4 text-xs text-slate-400">
        💡 تريد ربحاً حقيقياً فورياً بدل الانتظار لبيع إعلانات بنفسك؟ شغّل بوت الإعلانات والمهام مجاناً على قناتك من{" "}
        <a href="/watch-and-earn" className="font-bold text-indigo-700 underline">هنا</a>.
      </p>
    </main>
  );
}
