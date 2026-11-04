"use client";

import { useMemo, useState } from "react";
import { parseLocalizedNumber } from "@/lib/numberInput";
import {
  addCalendarDays,
  addDaysForDisplay,
  calculateDateDifference,
  formatLocalDate,
} from "@/lib/dateDifference";

export default function DateDifference() {
  const [from, setFrom] = useState(() => formatLocalDate(new Date()));
  const [to, setTo] = useState(() => addCalendarDays(formatLocalDate(new Date()), 30));
  const [add, setAdd] = useState("90");

  const diff = useMemo(() => calculateDateDifference(from, to), [from, to]);

  const added = useMemo(() => {
    const days = parseLocalizedNumber(add, { fallback: NaN });
    if (!Number.isFinite(days)) return "";
    return addDaysForDisplay(from, days);
  }, [from, add]);

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-extrabold text-slate-900">الفرق بين تاريخين</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-bold text-slate-700">من<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-2" /></label>
          <label className="text-sm font-bold text-slate-700">إلى<input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-2 py-2" /></label>
        </div>
        {diff && (
          <div className="rounded-xl bg-emerald-50 p-4 text-emerald-900">
            <div className="text-lg font-extrabold">{diff.years} سنة و{diff.months} شهر و{diff.days} يوم</div>
            <div className="mt-1 text-sm">= {diff.totalDays.toLocaleString("ar-SA")} يوماً = {diff.weeks.toLocaleString("ar-SA")} أسبوعاً = {diff.hours.toLocaleString("ar-SA")} ساعة</div>
          </div>
        )}
      </div>
      <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-extrabold text-slate-900">إضافة أيام إلى تاريخ</h2>
        <p className="text-sm text-slate-600">بعد <input value={add} onChange={(e) => setAdd(e.target.value)} inputMode="numeric" dir="ltr" className="mx-1 w-20 rounded-lg border border-slate-300 px-2 py-1 text-center" /> يوماً من تاريخ «من» (استعمل رقماً سالباً للرجوع):</p>
        {added && <div className="rounded-xl bg-emerald-50 px-4 py-3 font-extrabold text-emerald-900">{added}</div>}
      </div>
    </div>
  );
}
