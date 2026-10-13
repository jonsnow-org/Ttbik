"use client";

import { useMemo, useState } from "react";

const DAY = 86400000;
const fmtDate = (d: Date) => d.toLocaleDateString("ar-SA-u-ca-gregory", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

export default function PregnancyCalculator() {
  const [lmp, setLmp] = useState("");
  const [cycle, setCycle] = useState("28");

  const r = useMemo(() => {
    if (!lmp) return null;
    const start = new Date(lmp + "T00:00:00");
    if (Number.isNaN(start.getTime())) return null;
    const adj = (Math.min(45, Math.max(21, parseInt(cycle, 10) || 28)) - 28) * DAY;
    const due = new Date(start.getTime() + 280 * DAY + adj);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.floor((today.getTime() - start.getTime() - adj) / DAY);
    return {
      due,
      weeks: Math.floor(days / 7),
      rem: days % 7,
      days,
      conception: new Date(start.getTime() + 14 * DAY + adj),
      t2: new Date(start.getTime() + 13 * 7 * DAY + adj),
      t3: new Date(start.getTime() + 27 * 7 * DAY + adj),
      left: Math.ceil((due.getTime() - today.getTime()) / DAY),
    };
  }, [lmp, cycle]);

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6">
      <label className="block text-sm font-bold text-slate-700">
        تاريخ أول يوم من آخر دورة شهرية
        <input type="date" value={lmp} onChange={(e) => setLmp(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
      </label>
      <label className="block text-sm font-bold text-slate-700">
        طول الدورة (بالأيام، الافتراضي 28)
        <input value={cycle} onChange={(e) => setCycle(e.target.value)} inputMode="numeric" dir="ltr" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
      </label>
      {r && (
        <div className="space-y-2 text-slate-800">
          <div className="rounded-xl bg-pink-50 p-4">
            <div className="text-sm text-pink-700">موعد الولادة المتوقع</div>
            <div className="text-xl font-extrabold text-pink-900">{fmtDate(r.due)}</div>
          </div>
          {r.days >= 0 && r.days <= 300 && (
            <p className="rounded-xl bg-slate-50 p-3 text-sm font-bold">
              عمر الحمل الآن: {r.weeks} أسبوعاً و{r.rem} أيام — {r.left > 0 ? `متبقٍ نحو ${r.left} يوماً` : "حان الموعد المتوقع"}
            </p>
          )}
          <ul className="space-y-1 text-sm">
            <li>🌱 تاريخ الحمل التقريبي: {fmtDate(r.conception)}</li>
            <li>🌿 بداية الثلث الثاني (الأسبوع 14): {fmtDate(r.t2)}</li>
            <li>🌳 بداية الثلث الثالث (الأسبوع 28): {fmtDate(r.t3)}</li>
          </ul>
          <p className="text-xs text-slate-500">تقدير يعتمد على قاعدة نيجيلي (280 يوماً من آخر دورة)، ولا يغني عن الفحص بالسونار ومتابعة طبيبتك.</p>
        </div>
      )}
    </div>
  );
}
