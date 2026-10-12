"use client";

import { useEffect, useMemo, useState } from "react";
import ShareCard from "@/components/ShareCard";

const STORE_KEY = "lifeCounter.birth";
const DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

const ZODIAC: { name: string; icon: string; from: [number, number] }[] = [
  { name: "الجدي", icon: "♑", from: [12, 22] },
  { name: "الدلو", icon: "♒", from: [1, 20] },
  { name: "الحوت", icon: "♓", from: [2, 19] },
  { name: "الحمل", icon: "♈", from: [3, 21] },
  { name: "الثور", icon: "♉", from: [4, 20] },
  { name: "الجوزاء", icon: "♊", from: [5, 21] },
  { name: "السرطان", icon: "♋", from: [6, 21] },
  { name: "الأسد", icon: "♌", from: [7, 23] },
  { name: "العذراء", icon: "♍", from: [8, 23] },
  { name: "الميزان", icon: "♎", from: [9, 23] },
  { name: "العقرب", icon: "♏", from: [10, 23] },
  { name: "القوس", icon: "♐", from: [11, 22] },
];

function zodiac(m: number, d: number) {
  let pick = ZODIAC[0];
  for (const z of ZODIAC) {
    if (m > z.from[0] || (m === z.from[0] && d >= z.from[1])) pick = z;
  }
  // before Jan 20 -> Capricorn
  if (m === 1 && d < 20) pick = ZODIAC[0];
  return pick;
}

const n = (v: number) => Math.floor(v).toLocaleString("ar-SA");

function ymd(from: Date, to: Date) {
  let y = to.getFullYear() - from.getFullYear();
  let m = to.getMonth() - from.getMonth();
  let d = to.getDate() - from.getDate();
  if (d < 0) {
    m -= 1;
    d += new Date(to.getFullYear(), to.getMonth(), 0).getDate();
  }
  if (m < 0) {
    y -= 1;
    m += 12;
  }
  return { y, m, d };
}

export default function LifeCounter() {
  const [birth, setBirth] = useState("");
  const [now, setNow] = useState<number>(() => Date.now());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) setBirth(saved);
    } catch {}
  }, []);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const born = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) return null;
    const d = new Date(`${birth}T00:00:00`);
    return Number.isNaN(d.getTime()) || d.getTime() > Date.now() || d.getFullYear() < 1900 ? null : d;
  }, [birth]);

  function onChange(v: string) {
    setBirth(v);
    try {
      localStorage.setItem(STORE_KEY, v);
    } catch {}
  }

  const view = useMemo(() => {
    if (!born) return null;
    const cur = new Date(now);
    const secs = (now - born.getTime()) / 1000;
    const { y, m, d } = ymd(born, cur);
    const todayStart = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate());
    let next = new Date(cur.getFullYear(), born.getMonth(), born.getDate());
    if (next.getTime() < todayStart.getTime()) next = new Date(cur.getFullYear() + 1, born.getMonth(), born.getDate());
    const isToday = next.getTime() === todayStart.getTime();
    const daysToNext = isToday ? 0 : Math.round((next.getTime() - todayStart.getTime()) / 86400000);
    let hijri = "";
    try {
      hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura", { day: "numeric", month: "long", year: "numeric" }).format(born);
    } catch {}
    const z = zodiac(born.getMonth() + 1, born.getDate());
    return { secs, y, m, d, daysToNext, isToday, hijri, z, weekday: DAYS_AR[born.getDay()], nextAge: y + (isToday ? 0 : 1) };
  }, [born, now]);

  const shareText = view
    ? `⏱️ عمري الآن ${view.y} سنة و${view.m} شهراً و${view.d} يوماً — أي ${n(view.secs / 86400)} يوم و${n(view.secs)} ثانية!\nاحسب عمرك أنت: ${typeof window !== "undefined" ? window.location.href : ""}`
    : "";

  async function share() {
    try {
      if (navigator.share) {
        await navigator.share({ text: shareText });
        return;
      }
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <label className="text-sm font-bold text-slate-800" htmlFor="birth">تاريخ ميلادك</label>
        <input
          id="birth"
          type="date"
          value={birth}
          max={new Date().toISOString().slice(0, 10)}
          min="1900-01-01"
          onChange={(e) => onChange(e.target.value)}
          className="mt-2 w-full rounded-xl border px-3 py-2 text-sm"
        />
        {birth && !born && <p className="mt-2 text-xs text-red-700">أدخل تاريخاً صحيحاً في الماضي.</p>}
        <p className="mt-2 text-[11px] text-slate-500">يُحفظ التاريخ في متصفحك فقط لتجده عند عودتك.</p>
      </div>

      {view && (
        <>
          <div className="rounded-3xl bg-gradient-to-br from-indigo-700 via-violet-700 to-fuchsia-700 p-6 text-center text-white shadow-lg">
            <p className="text-xs font-bold opacity-80">عمرك الآن</p>
            <p className="mt-1 text-2xl font-extrabold">
              {n(view.y)} سنة و{n(view.m)} شهراً و{n(view.d)} يوماً
            </p>
            <p className="mt-4 text-[11px] font-bold opacity-80">عدد الثواني التي عشتها</p>
            <p className="font-mono text-3xl font-black tabular-nums" aria-live="off">{n(view.secs)}</p>
          </div>
          <ShareCard kicker="عداد العمر" title={`${n(view.y)} سنة`} lines={[{ label: "الأشهر والأيام", value: `${n(view.m)} شهر و${n(view.d)} يوم` }, { label: "الثواني", value: n(view.secs) }]} path="/free-tools/life-counter" />

          <div className="grid grid-cols-2 gap-3">
            {[
              { i: "📅", l: "أيام عشتها", v: n(view.secs / 86400) },
              { i: "🕐", l: "ساعات", v: n(view.secs / 3600) },
              { i: "❤️", l: "نبضة قلب تقريباً", v: n((view.secs / 60) * 72) },
              { i: "😴", l: "سنوات نوم تقريباً", v: (view.secs / 86400 / 365.25 / 3).toLocaleString("ar-SA", { maximumFractionDigits: 1 }) },
              { i: "🌬️", l: "نَفَس تقريباً", v: n((view.secs / 60) * 16) },
              { i: "🌙", l: "دورة قمرية تقريباً", v: n(view.secs / 86400 / 29.53) },
            ].map((c) => (
              <div key={c.l} className="rounded-2xl border border-slate-200 bg-white p-3 text-center">
                <p className="text-lg">{c.i}</p>
                <p className="text-lg font-extrabold text-slate-900 tabular-nums">{c.v}</p>
                <p className="text-[11px] text-slate-500">{c.l}</p>
              </div>
            ))}
          </div>

          <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
            <p>🎂 وُلدت يوم <b>{view.weekday}</b>{view.hijri ? <> — الموافق <b>{view.hijri}</b></> : null}</p>
            <p>{view.z.icon} برجك: <b>{view.z.name}</b></p>
            <p>
              {view.isToday ? (
                <>🎉 <b>كل عام وأنت بخير!</b> اليوم عيد ميلادك الـ{n(view.y)}</>
              ) : (
                <>🎈 تبقّى <b>{n(view.daysToNext)}</b> يوماً على عيد ميلادك الـ{n(view.nextAge)}</>
              )}
            </p>
          </div>

          <button onClick={share} className="w-full rounded-xl bg-indigo-700 py-3 text-sm font-bold text-white">
            {copied ? "✅ نُسخ النص" : "📤 شارك بطاقة عمرك"}
          </button>
          <p className="text-center text-[11px] text-slate-400">أرقام النبض والنَّفَس والنوم تقديرية للتسلية.</p>
        </>
      )}
    </div>
  );
}
