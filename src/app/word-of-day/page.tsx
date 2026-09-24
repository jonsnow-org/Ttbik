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

const FAQ = [
  {
    q: "من أين تأتي الكلمة؟",
    a: "من قائمة ثابتة على الموقع. المعاني موجزة قصيرة مكتوبة لهذه الصفحة، وليست نسخاً من معجم.",
  },
  {
    q: "متى تتغيّر الكلمة؟",
    a: "مرة واحدة في اليوم حسب تاريخ UTC، ليس حسب منطقة الزائر. التاريخ المعتمد ظاهر فوق الكلمة.",
  },
  {
    q: "هل هذا قاموس لغوي؟",
    a: "لا. الصفحة تعرض كلمة واحدة ومعنى قصيراً ومثالاً، وليست مرجعاً لغوياً ولا معجماً كاملاً.",
  },
];

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
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: { "@type": "Answer", text: item.a },
    })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
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
        <h2 className="mb-3 mt-8 text-lg font-extrabold text-slate-900">أسئلة شائعة</h2>
        <dl className="space-y-3">
          {FAQ.map((item) => (
            <div key={item.q} className="rounded-xl border border-slate-200 bg-white p-4">
              <dt className="mb-1 text-sm font-bold text-slate-900">{item.q}</dt>
              <dd className="text-sm leading-6 text-slate-600">{item.a}</dd>
            </div>
          ))}
        </dl>
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
