import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import { PRAYER_CITIES } from "@/lib/prayerCities";

const SITE = "https://souqtools.com";
const PATH = "/prayer-times";

export const metadata: Metadata = {
  title: "مواقيت الصلاة والمدن العربية | سوق تولز",
  description:
    "مواقيت الفجر والشروق والظهر والعصر والمغرب والعشاء لمدن عربية، مع التاريخ الهجري واتجاه القبلة. الحساب محلي بلا واجهة مدفوعة.",
  keywords: ["مواقيت الصلاة", "أذان", "هجري", "قبلة", "سوق تولز"],
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "مواقيت الصلاة | سوق تولز",
    description: "حساب محلي لمواقيت الصلاة في مدن عربية مع الهجري والقبلة.",
    url: `${SITE}${PATH}`,
    locale: "ar_AR",
    type: "website",
    images: [{ url: `${SITE}/opengraph-image` }],
  },
};

const BREADCRUMB = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "الرئيسة", item: SITE },
    { "@type": "ListItem", position: 2, name: "مواقيت الصلاة", item: `${SITE}${PATH}` },
  ],
};

const byCountry = PRAYER_CITIES.reduce<Record<string, typeof PRAYER_CITIES>>((acc, city) => {
  acc[city.countryAr] = acc[city.countryAr] || [];
  acc[city.countryAr].push(city);
  return acc;
}, {});

export default function PrayerTimesHubPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB) }} />
      <main className="mx-auto max-w-2xl px-4 py-8" dir="rtl" lang="ar">
        <nav className="mb-5 text-sm text-slate-500" aria-label="مسار التنقل">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/" className="hover:text-slate-800">
                الرئيسة
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-slate-800">مواقيت الصلاة</li>
          </ol>
        </nav>
        <h1 className="mb-2 text-2xl font-extrabold text-slate-900">مواقيت الصلاة</h1>
        <p className="mb-6 text-sm leading-7 text-slate-600">
          الحساب يتم على الخادم من إحداثيات المدينة وطريقة معتمدة لكل بلد (أم القرى للسعودية والخليج، الهيئة المصرية لمصر والشام، رابطة العالم الإسلامي للمغرب العربي). ليست هذه أذاناً رسمياً لمسجد محدد. التاريخ الهجري وفق تقويم أم القرى عبر Intl.
        </p>
        {Object.entries(byCountry).map(([country, cities]) => (
          <section key={country} className="mb-6">
            <h2 className="mb-2 text-sm font-extrabold text-slate-800">{country}</h2>
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {cities.map((c) => (
                <li key={c.slug}>
                  <Link
                    href={`/prayer-times/${c.slug}`}
                    className="block rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-indigo-800 hover:border-indigo-300"
                  >
                    {c.nameAr}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="mb-6 text-sm">
          <Link href="/news" className="font-bold text-indigo-800 hover:underline">
            مركز الأخبار ←
          </Link>
        </p>
        <AdSlot position="in-content" label="أسفل دليل مواقيت الصلاة" />
      </main>
    </>
  );
}
