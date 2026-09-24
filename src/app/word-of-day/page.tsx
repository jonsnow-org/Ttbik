import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import { SITE_URL } from "@/lib/siteUrl";
import { wordOfDay } from "@/lib/wordOfDay";

const SITE = SITE_URL;
const PATH = "/word-of-day";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "كلمة اليوم | سوق تولز",
  description: "كلمة عربية يومية بمعنى قصير ومثال استعمال. تتبدّل حسب تاريخ UTC.",
  alternates: { canonical: `${SITE}${PATH}` },
};

export default function WordOfDayPage() {
  const w = wordOfDay();
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "كلمة اليوم",
    url: `${SITE}${PATH}`,
    dateModified: w.dateIso,
    description: `${w.word}: ${w.meaning}`,
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسة", item: SITE },
      { "@type": "ListItem", position: 2, name: "كلمة اليوم", item: `${SITE}${PATH}` },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <main className="mx-auto max-w-lg px-4 py-8 text-slate-700" dir="rtl" lang="ar">
        <nav className="mb-5 text-sm text-slate-500" aria-label="مسار التنقل">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/" className="hover:text-slate-800">
                الرئيسة
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-slate-800">كلمة اليوم</li>
          </ol>
        </nav>
        <p className="mb-2 text-xs text-slate-500">تاريخ UTC: {w.dateIso}</p>
        <h1 className="mb-3 text-3xl font-extrabold text-slate-900">{w.word}</h1>
        <p className="mb-4 text-base leading-7">{w.meaning}</p>
        <p className="mb-6 rounded-lg bg-slate-50 p-3 text-sm leading-7">مثال: {w.example}</p>
        <AdSlot position="in-content" label="وسط صفحة كلمة اليوم" />
        <p className="mt-8 text-sm">
          <Link href="/news" className="font-bold text-indigo-800 hover:underline">
            مركز الأخبار ←
          </Link>
          {" · "}
          <Link href="/events" className="font-bold text-indigo-800 hover:underline">
            الأحداث ←
          </Link>
        </p>
      </main>
    </>
  );
}
