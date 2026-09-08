"use client";

import { useMemo, useState } from "react";

const HIJRI_MONTHS = [
  "محرّم",
  "صفر",
  "ربيع الأول",
  "ربيع الآخر",
  "جمادى الأولى",
  "جمادى الآخرة",
  "رجب",
  "شعبان",
  "رمضان",
  "شوّال",
  "ذو القعدة",
  "ذو الحجة",
];

const GREG_MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

const WEEKDAYS = [
  "الأحد",
  "الإثنين",
  "الثلاثاء",
  "الأربعاء",
  "الخميس",
  "الجمعة",
  "السبت",
];

/** Kuwaiti algorithm (common pure-JS Hijri ↔ Gregorian). Accurate enough for civil/religious calendars. */
function gregorianToHijri(gy: number, gm: number, gd: number) {
  let y = gy;
  let m = gm;
  let d = gd;
  if (m < 3) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  const jd =
    Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (m + 1)) +
    d +
    b -
    1524.5;
  const i = Math.floor((jd - 1948439.5) / 29.5305882);
  const jd1 = 1948439.5 + i * 29.5305882;
  const k = Math.floor((jd - jd1) / 1);
  let hy = Math.floor((30 * i + 10646) / 10631);
  let hm = Math.floor((k + 0.5) / 29.5) + 1;
  if (hm > 12) {
    hm = 12;
  }
  let hd = Math.floor(jd - jd1 - (hm - 1) * 29.5) + 1;
  if (hd < 1) hd = 1;
  if (hd > 30) hd = 30;
  // refine month length roughly
  const monthLen = [30, 29, 30, 29, 30, 29, 30, 29, 30, 29, 30, 29];
  if (hd > monthLen[hm - 1]) hd = monthLen[hm - 1];
  return { hy, hm, hd };
}

function hijriToGregorian(hy: number, hm: number, hd: number) {
  const jd =
    Math.floor((11 * hy + 3) / 30) +
    354 * hy +
    30 * hm -
    Math.floor((hm - 1) / 2) +
    hd +
    1948440 -
    385;
  const z = Math.floor(jd + 0.5);
  const a = Math.floor((z - 1867216.25) / 36524.25);
  const aa = z + 1 + a - Math.floor(a / 4);
  const b = aa + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);
  const day = b - d - Math.floor(30.6001 * e);
  let month = e - 1;
  if (month > 12) month -= 12;
  let year = c - 4716;
  if (month < 3) year += 1;
  return { gy: year, gm: month, gd: day };
}

function weekdayFromGreg(gy: number, gm: number, gd: number): string {
  const dt = new Date(Date.UTC(gy, gm - 1, gd));
  return WEEKDAYS[dt.getUTCDay()];
}

function clamp(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

export default function HijriConverter() {
  const [dir, setDir] = useState<"h2g" | "g2h">("g2h");
  const [day, setDay] = useState("1");
  const [month, setMonth] = useState("1");
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const [copied, setCopied] = useState(false);

  const result = useMemo(() => {
    const d = clamp(parseInt(day, 10), 1, 31);
    const m = clamp(parseInt(month, 10), 1, 12);
    const y = clamp(parseInt(year, 10), 1, 9999);
    if (dir === "g2h") {
      const h = gregorianToHijri(y, m, d);
      const wd = weekdayFromGreg(y, m, d);
      return {
        outDay: h.hd,
        outMonth: h.hm,
        outYear: h.hy,
        monthName: HIJRI_MONTHS[h.hm - 1] ?? "",
        weekday: wd,
        label: "هجري",
        inputLabel: "ميلادي",
        inputDay: d,
        inputMonth: m,
        inputYear: y,
        inputMonthName: GREG_MONTHS[m - 1] ?? "",
      };
    } else {
      const g = hijriToGregorian(y, m, d);
      const wd = weekdayFromGreg(g.gy, g.gm, g.gd);
      return {
        outDay: g.gd,
        outMonth: g.gm,
        outYear: g.gy,
        monthName: GREG_MONTHS[g.gm - 1] ?? "",
        weekday: wd,
        label: "ميلادي",
        inputLabel: "هجري",
        inputDay: d,
        inputMonth: m,
        inputYear: y,
        inputMonthName: HIJRI_MONTHS[m - 1] ?? "",
      };
    }
  }, [dir, day, month, year]);

  const inputMonthNames = dir === "g2h" ? GREG_MONTHS : HIJRI_MONTHS;

  async function copyResult() {
    if (!result) return;
    const text = [
      `التاريخ المدخل (${result.inputLabel}): ${result.inputDay} ${result.inputMonthName} ${result.inputYear}`,
      `التاريخ المقابل (${result.label}): ${result.outDay} ${result.monthName} ${result.outYear}`,
      `اليوم: ${result.weekday}`,
      `رقمي: ${result.outDay}/${result.outMonth}/${result.outYear}`,
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5">
      <div className="flex gap-2 rounded-xl bg-slate-100 p-1">
        <button
          type="button"
          onClick={() => setDir("g2h")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
            dir === "g2h"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500"
          }`}
        >
          ميلادي ← هجري
        </button>
        <button
          type="button"
          onClick={() => setDir("h2g")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold transition ${
            dir === "h2g"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-500"
          }`}
        >
          هجري ← ميلادي
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">
            اليوم
          </label>
          <input
            value={day}
            onChange={(e) => setDay(e.target.value)}
            inputMode="numeric"
            dir="ltr"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
            placeholder="1–31"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">
            الشهر
          </label>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none bg-white"
          >
            {inputMonthNames.map((name, i) => (
              <option key={name} value={String(i + 1)}>
                {i + 1} — {name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-700">
            السنة
          </label>
          <input
            value={year}
            onChange={(e) => setYear(e.target.value)}
            inputMode="numeric"
            dir="ltr"
            className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
            placeholder={dir === "g2h" ? "2026" : "1447"}
          />
        </div>
      </div>

      {result && (
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-5 text-center space-y-1">
          <p className="text-xs text-slate-500">التاريخ المقابل ({result.label})</p>
          <p className="text-2xl font-extrabold text-slate-900">
            {result.outDay} {result.monthName} {result.outYear}
          </p>
          <p className="text-sm text-slate-600">{result.weekday}</p>
          <p className="text-[11px] text-slate-400 pt-1" dir="ltr">
            {result.outDay}/{result.outMonth}/{result.outYear}
          </p>
          <button
            type="button"
            onClick={copyResult}
            className="mt-3 w-full rounded-lg border border-emerald-200 bg-white py-1.5 text-xs font-semibold text-slate-700 hover:bg-emerald-50 transition"
          >
            {copied ? "تم النسخ ✓" : "نسخ النتيجة"}
          </button>
        </div>
      )}

      <p className="text-[11px] text-slate-400 text-center leading-relaxed">
        تحويل تقريبي مبني على خوارزمية مدنية شائعة (قريبة من تقويم أم القرى).
        للمناسبات الشرعية الدقيقة راجع المصادر الرسمية.
        <br />
        تعمل بالكامل داخل المتصفح — بلا تسجيل وبلا تخزين.
      </p>
    </div>
  );
}
