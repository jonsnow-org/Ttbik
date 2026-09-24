import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import { PRAYER_CITIES, getPrayerCity } from "@/lib/prayerCities";
import { PRAYER_LABELS, computePrayerTimes } from "@/lib/prayerCalc";
import NextPrayerCountdown from "./NextPrayerCountdown";

const SITE = "https://souqtools.com";

type Params = { city: string };

export function generateStaticParams() {
  return PRAYER_CITIES.map((c) => ({ city: c.slug }));
}

export function generateMetadata({ params }: { params: Params }): Metadata {
  const city = getPrayerCity(params.city);
  if (!city) return { title: "مواقيت الصلاة" };
  return {
    title: `مواقيت الصلاة في ${city.nameAr} | سوق تولز`,
    description: `أوقات الصلاة اليوم في ${city.nameAr} — ${city.countryAr}. طريقة ${city.methodLabel}. ${city.note}`,
    alternates: { canonical: `${SITE}/prayer-times/${city.slug}` },
    openGraph: {
      title: `مواقيت الصلاة في ${city.nameAr}`,
      description: city.note,
      url: `${SITE}/prayer-times/${city.slug}`,
      locale: "ar_AR",
      type: "website",
      images: [{ url: `${SITE}/opengraph-image` }],
    },
  };
}

export default function PrayerCityPage({ params }: { params: Params }) {
  const city = getPrayerCity(params.city);
  if (!city) notFound();
  const now = new Date();
  const result = computePrayerTimes(city, now);
  const names = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"] as const;

  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسة", item: SITE },
      { "@type": "ListItem", position: 2, name: "مواقيت الصلاة", item: `${SITE}/prayer-times` },
      { "@type": "ListItem", position: 3, name: city.nameAr, item: `${SITE}/prayer-times/${city.slug}` },
    ],
  };

  const neighbors = PRAYER_CITIES.filter((c) => c.countryAr === city.countryAr && c.slug !== city.slug).slice(0, 4);

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }} />
      <main className="mx-auto max-w-lg px-4 py-8" dir="rtl" lang="ar">
        <nav className="mb-5 text-sm text-slate-500" aria-label="مسار التنقل">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/" className="hover:text-slate-800">
                الرئيسة
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href="/prayer-times" className="hover:text-slate-800">
                مواقيت الصلاة
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-slate-800">{city.nameAr}</li>
          </ol>
        </nav>
        <h1 className="mb-1 text-2xl font-extrabold text-slate-900">مواقيت الصلاة في {city.nameAr}</h1>
        <p className="mb-1 text-sm text-slate-600">
          {city.countryAr} · {city.methodLabel}
        </p>
        <p className="mb-4 text-sm leading-7 text-slate-700">{city.note}</p>
        <p className="mb-4 text-sm text-slate-600">
          {result.gregorian}
          <br />
          {result.hijri}
        </p>
        <ul className="mb-6 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {names.map((name) => (
            <li key={name} className="flex items-center justify-between px-4 py-3 text-sm">
              <span className="font-bold text-slate-800">{PRAYER_LABELS[name]}</span>
              <time className="font-mono text-slate-900">{result.times[name].label}</time>
            </li>
          ))}
        </ul>
        <NextPrayerCountdown nextName={PRAYER_LABELS[result.next]} nextIso={result.times[result.next].date.toISOString()} />
        <p className="mb-6 text-sm text-slate-700">
          اتجاه القبلة من إحداثيات المدينة نحو الكعبة: {Math.round(result.qibla)}° من الشمال الجغرافي.
        </p>
        {neighbors.length > 0 && (
          <aside className="mb-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="mb-2 text-sm font-extrabold">مدن قريبة في نفس البلد</h2>
            <ul className="space-y-1 text-sm font-bold text-indigo-800">
              {neighbors.map((n) => (
                <li key={n.slug}>
                  <Link href={`/prayer-times/${n.slug}`} className="hover:underline">
                    {n.nameAr}
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        )}
        <p className="mb-6 text-xs leading-6 text-slate-500">
          الحساب فلكي تقريبي وليس بياناً رسمياً لوزارة أو مسجد. لا نعلّم هذه الصفحة كـ Event في البيانات المنظمة.
        </p>
        <p className="mb-6 text-sm">
          <Link href="/news" className="font-bold text-indigo-800 hover:underline">
            مركز الأخبار ←
          </Link>
        </p>
        <AdSlot position="in-content" label={`أسفل مواقيت ${city.nameAr}`} />
      </main>
    </>
  );
}
