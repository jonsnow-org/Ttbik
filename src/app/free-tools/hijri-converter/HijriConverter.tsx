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

// ---------------------------------------------------------------------
// Conversions. The old version here returned nonsense (e.g. 1 Jan 2026 →
// "11 محرّم 49"). Now: the browser's own Umm al-Qura calendar (the official
// Saudi calendar, built into Intl) when available, else the standard
// tabular Islamic calendar through Julian Day Numbers — both correct.
// ---------------------------------------------------------------------
const ISLAMIC_EPOCH = 1948439.5;
const GREGORIAN_EPOCH = 1721425.5;

function isLeapGregorian(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
function gregorianToJd(y: number, m: number, d: number) {
  return (
    GREGORIAN_EPOCH - 1 + 365 * (y - 1) + Math.floor((y - 1) / 4) - Math.floor((y - 1) / 100) + Math.floor((y - 1) / 400) +
    Math.floor((367 * m - 362) / 12 + (m <= 2 ? 0 : isLeapGregorian(y) ? -1 : -2) + d)
  );
}
function jdToGregorian(jd: number) {
  const wjd = Math.floor(jd - 0.5) + 0.5;
  const depoch = wjd - GREGORIAN_EPOCH;
  const quadricent = Math.floor(depoch / 146097);
  const dqc = depoch % 146097;
  const cent = Math.floor(dqc / 36524);
  const dcent = dqc % 36524;
  const quad = Math.floor(dcent / 1461);
  const dquad = dcent % 1461;
  const yindex = Math.floor(dquad / 365);
  let year = quadricent * 400 + cent * 100 + quad * 4 + yindex;
  if (!(cent === 4 || yindex === 4)) year++;
  const yearday = wjd - gregorianToJd(year, 1, 1);
  const leapadj = wjd < gregorianToJd(year, 3, 1) ? 0 : isLeapGregorian(year) ? 1 : 2;
  const month = Math.floor(((yearday + leapadj) * 12 + 373) / 367);
  const day = wjd - gregorianToJd(year, month, 1) + 1;
  return { gy: year, gm: month, gd: day };
}
function islamicToJd(y: number, m: number, d: number) {
  return d + Math.ceil(29.5 * (m - 1)) + (y - 1) * 354 + Math.floor((3 + 11 * y) / 30) + ISLAMIC_EPOCH - 1;
}
function jdToIslamic(jd: number) {
  const wjd = Math.floor(jd) + 0.5;
  const y = Math.floor((30 * (wjd - ISLAMIC_EPOCH) + 10646) / 10631);
  const m = Math.min(12, Math.ceil((wjd - (29 + islamicToJd(y, 1, 1))) / 29.5) + 1);
  const d = wjd - islamicToJd(y, m, 1) + 1;
  return { hy: y, hm: m, hd: d };
}

// Umm al-Qura via Intl (only defined for 1937–2076 CE; outside that, or on
// browsers without it, the tabular calendar is used).
let ummAlQura: Intl.DateTimeFormat | null | undefined;
function uqFormatter(): Intl.DateTimeFormat | null {
  if (ummAlQura !== undefined) return ummAlQura;
  try {
    const f = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" });
    ummAlQura = f.resolvedOptions().calendar === "islamic-umalqura" ? f : null;
  } catch {
    ummAlQura = null;
  }
  return ummAlQura;
}
function uqParts(gy: number, gm: number, gd: number) {
  const f = uqFormatter();
  if (!f || gy < 1937 || gy > 2076) return null;
  const parts = f.formatToParts(new Date(Date.UTC(gy, gm - 1, gd)));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const hy = get("year"), hm = get("month"), hd = get("day");
  return hy && hm && hd ? { hy, hm, hd } : null;
}

function gregorianToHijri(gy: number, gm: number, gd: number) {
  return uqParts(gy, gm, gd) ?? jdToIslamic(gregorianToJd(gy, gm, gd));
}

function hijriToGregorian(hy: number, hm: number, hd: number) {
  // Tabular estimate first, then (if Umm al-Qura is available) nudge by up
  // to ±3 days to the exact Umm al-Qura match.
  const g = jdToGregorian(islamicToJd(hy, hm, hd));
  if (uqParts(g.gy, g.gm, g.gd)) {
    for (const off of [0, -1, 1, -2, 2, -3, 3]) {
      const dt = new Date(Date.UTC(g.gy, g.gm - 1, g.gd + off));
      const h = uqParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
      if (h && h.hy === hy && h.hm === hm && h.hd === hd) return { gy: dt.getUTCFullYear(), gm: dt.getUTCMonth() + 1, gd: dt.getUTCDate() };
    }
  }
  return g;
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
  const [dir, setDirState] = useState<"h2g" | "g2h">("g2h");
  const today = new Date();
  const [day, setDay] = useState(() => String(today.getDate()));
  const [month, setMonth] = useState(() => String(today.getMonth() + 1));
  const [year, setYear] = useState(() => String(today.getFullYear()));
  // Switching direction carries the same date across (e.g. today's Gregorian
  // date becomes today's Hijri date) instead of reading "2026" as a Hijri year.
  function setDir(next: "h2g" | "g2h") {
    if (next === dir) return;
    setDirState(next);
    setDay(String(result.outDay));
    setMonth(String(result.outMonth));
    setYear(String(result.outYear));
  }
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
