import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPrayerCity } from "@/lib/prayerCities";
import { PRAYER_LABELS, computePrayerTimes } from "@/lib/prayerCalc";
import { SITE_URL } from "@/lib/siteUrl";
import EmbedCountdown from "./EmbedCountdown";

export const dynamic = "force-dynamic";

// The widget page duplicates /prayer-times/<city>; keep it out of the index
// so the canonical city page is the one that ranks.
export const metadata: Metadata = { robots: { index: false, follow: true } };

const NAMES = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"] as const;

export default function PrayerEmbed({ params, searchParams }: { params: { city: string }; searchParams: { theme?: string } }) {
  const city = getPrayerCity(params.city);
  if (!city) notFound();
  const r = computePrayerTimes(city, new Date());
  const dark = searchParams.theme === "dark";
  const cityUrl = `${SITE_URL}/prayer-times/${city.slug}?utm_source=widget`;

  return (
    <div
      className={`mx-auto max-w-[340px] rounded-2xl border p-3 text-sm ${
        dark ? "border-slate-700 bg-slate-900 text-slate-100" : "border-slate-200 bg-white text-slate-800"
      }`}
    >
      <p className="text-center text-base font-extrabold">مواقيت الصلاة في {city.nameAr}</p>
      <p className={`mb-2 text-center text-[11px] ${dark ? "text-slate-400" : "text-slate-500"}`}>{r.hijri}</p>
      <ul className={`divide-y ${dark ? "divide-slate-700" : "divide-slate-100"}`}>
        {NAMES.map((n) => (
          <li
            key={n}
            className={`flex justify-between px-1 py-1.5 ${n === r.next ? "font-extrabold text-indigo-500" : ""}`}
          >
            <span>{PRAYER_LABELS[n]}</span>
            <time className="font-mono">{r.times[n].label}</time>
          </li>
        ))}
      </ul>
      <EmbedCountdown nextName={PRAYER_LABELS[r.next]} nextIso={r.nextDate.toISOString()} />
      <a
        href={cityUrl}
        target="_blank"
        rel="noopener"
        className={`mt-2 block text-center text-[11px] font-bold ${dark ? "text-indigo-300" : "text-indigo-700"} hover:underline`}
      >
        المواقيت كاملة من سوق تولز ←
      </a>
    </div>
  );
}
