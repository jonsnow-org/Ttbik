"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { PRAYER_CITIES, type PrayerCity } from "@/lib/prayerCities";
import { PRAYER_LABELS, computePrayerTimes, type PrayerName } from "@/lib/prayerCalc";

const CITY_KEY = "ttbik_prayer_city";
const DEFAULT_SLUG = "makkah";
// Sunrise ends Fajr's window but isn't a prayer — skip it for "next prayer".
const PRAYERS: PrayerName[] = ["fajr", "dhuhr", "asr", "maghrib", "isha"];

// Guess the visitor's city from the browser's IANA time zone (no location
// permission, nothing sent anywhere). Several cities share a zone
// (Asia/Riyadh → الرياض/جدة/مكة…); the first listed one wins and the visitor
// can change it from the dropdown, which is remembered locally.
function cityFromTimeZone(): PrayerCity | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return PRAYER_CITIES.find((c) => c.tz === tz);
  } catch {
    return undefined;
  }
}

function nextPrayer(city: PrayerCity, now: Date) {
  const today = computePrayerTimes(city, now);
  for (const name of PRAYERS) {
    const d = today.times[name].date;
    if (d.getTime() > now.getTime()) return { name, date: d, label: today.times[name].label, hijri: today.hijri };
  }
  // After Isha: tomorrow's Fajr (computePrayerTimes already rolls nextDate over).
  const label = new Intl.DateTimeFormat("ar-EG", { timeZone: city.tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(
    today.nextDate,
  );
  return { name: "fajr" as PrayerName, date: today.nextDate, label, hijri: today.hijri };
}

function fmtLeft(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}س ${m}د ${s}ث` : `${m}د ${s}ث`;
}

export default function TodayStrip({ latestEvent }: { latestEvent?: { slug: string; title: string } }) {
  const [slug, setSlug] = useState<string | null>(null);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(CITY_KEY);
    } catch {
      // storage blocked — fall back to the time-zone guess
    }
    const fromSaved = saved ? PRAYER_CITIES.find((c) => c.slug === saved) : undefined;
    setSlug((fromSaved ?? cityFromTimeZone())?.slug ?? DEFAULT_SLUG);
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const city = useMemo(() => PRAYER_CITIES.find((c) => c.slug === slug), [slug]);
  // Recompute the schedule once a minute, not every tick.
  const minuteKey = now ? Math.floor(now.getTime() / 60_000) : 0;
  const next = useMemo(
    () => (city && now ? nextPrayer(city, now) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [city, minuteKey],
  );

  function choose(value: string) {
    setSlug(value);
    try {
      localStorage.setItem(CITY_KEY, value);
    } catch {
      // not persisted — still applies for this visit
    }
  }

  return (
    <section aria-label="اليوم" className="mx-auto max-w-6xl px-4 pt-4">
      <div className="grid gap-3 rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm sm:grid-cols-[1.4fr_1fr] sm:items-center">
        <div className="min-h-[76px]">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 font-bold text-indigo-700">🕌 الصلاة القادمة</span>
            <label className="sr-only" htmlFor="today-city">
              المدينة
            </label>
            <select
              id="today-city"
              value={slug ?? ""}
              onChange={(e) => choose(e.target.value)}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700"
            >
              {!slug && <option value="">…</option>}
              {PRAYER_CITIES.map((c) => (
                <option key={c.slug} value={c.slug}>
                  {c.nameAr} — {c.countryAr}
                </option>
              ))}
            </select>
            {next && <span className="hidden sm:inline">{next.hijri}</span>}
          </div>
          {city && next && now ? (
            <p className="mt-2 text-slate-800">
              <strong className="text-lg text-slate-900">{PRAYER_LABELS[next.name]}</strong>{" "}
              <span className="text-sm">في {city.nameAr} الساعة {next.label}</span>
              <span className="mr-2 inline-block rounded-lg bg-indigo-600 px-2 py-0.5 text-sm font-bold tabular-nums text-white">
                بعد {fmtLeft(next.date.getTime() - now.getTime())}
              </span>{" "}
              <Link href={`/prayer-times/${city.slug}`} className="text-sm font-bold text-indigo-700 hover:underline">
                كل مواقيت {city.nameAr} ←
              </Link>
            </p>
          ) : (
            <p className="mt-2 text-sm text-slate-400">جارٍ حساب المواقيت…</p>
          )}
        </div>
        <div className="flex flex-col gap-1.5 border-t border-slate-100 pt-3 text-sm sm:border-r sm:border-t-0 sm:pr-4 sm:pt-0">
          <Link href="/news" className="font-bold text-slate-800 hover:text-indigo-700">
            📰 خبر اليوم بمصدرين + الشريط العاجل ←
          </Link>
          {latestEvent && (
            <Link href={`/events/${latestEvent.slug}`} className="line-clamp-1 text-slate-600 hover:text-indigo-700">
              🗓️ {latestEvent.title}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
