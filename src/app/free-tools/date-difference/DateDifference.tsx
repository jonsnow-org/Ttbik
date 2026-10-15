"use client";

import { useMemo, useState } from "react";

const iso = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86400000;

export default function DateDifference() {
  const [from, setFrom] = useState(iso(new Date()));
  const [to, setTo] = useState(iso(new Date(Date.now() + 30 * DAY)));
  const [add, setAdd] = useState("90");

  const diff = useMemo(() => {
    const a = new Date(from + "T00:00:00Z");
    const b = new Date(to + "T00:00:00Z");
    if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
    const [s, e] = a <= b ? [a, b] : [b, a];
    let y = e.getUTCFullYear() - s.getUTCFullYear();
    let m = e.getUTCMonth() - s.getUTCMonth();
    let d = e.getUTCDate() - s.getUTCDate();
    if (d < 0) {
      m -= 1;
      d += new Date(Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), 0)).getUTCDate();
    }
    if (m < 0) {
      y -= 1;
      m += 12;
    }
    const days = Math.round((e.getTime() - s.getTime()) / DAY);
    return { y, m, d, days, weeks: Math.floor(days / 7), hours: days * 24 };
  }, [from, to]);

  const added = useMemo(() => {
    const a = new Date(from + "T00:00:00Z");
    const n = parseInt(add, 10);
    if (Number.isNaN(a.getTime()) || !Number.isFinite(n)) return "";
    return new Date(a.getTime() + n * DAY).toLocaleDateString("ar-SA-u-ca-gregory", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
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
            <div className="text-lg font-extrabold">{diff.y} سنة و{diff.m} شهر و{diff.d} يوم</div>
            <div className="mt-1 text-sm">= {diff.days.toLocaleString("ar-SA")} يوماً = {diff.weeks.toLocaleString("ar-SA")} أسبوعاً = {diff.hours.toLocaleString("ar-SA")} ساعة</div>
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
