import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";

const SITE = "https://souqtools.com";
const PATH = "/events";

export const metadata: Metadata = {
  title: "أحداث ومقالات | سوق تولز",
  description:
    "شروحات قصيرة بمصادر: ظواهر فلكية، معلومات مفيدة، بلا قصص مختلقة.",
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "أحداث ومقالات | سوق تولز",
    description: "مقالات يومية بمصادر يمكن فتحها.",
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
    { "@type": "ListItem", position: 2, name: "أحداث", item: `${SITE}${PATH}` },
  ],
};

const ITEMS = [
  {
    slug: "autumn-equinox-2026",
    title: "ما الذي نعرفه عن الاعتدال الخريفي 2026؟",
    dateLabel: "24 سبتمبر 2026",
    blurb: "الموعد الفلكي، لماذا لا يتساوى الليل والنهار دقيقة بدقيقة، ومتى ينتهي الفصل.",
  },
];

export default function EventsIndexPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB) }}
      />
      <main className="mx-auto max-w-2xl px-4 py-8" dir="rtl" lang="ar">
        <nav className="mb-5 text-sm text-slate-500" aria-label="مسار التنقل">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/" className="hover:text-slate-800">
                الرئيسة
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-slate-800">أحداث</li>
          </ol>
        </nav>
        <h1 className="mb-2 text-2xl font-extrabold text-slate-900">أحداث ومقالات</h1>
        <p className="mb-6 text-sm leading-7 text-slate-600">
          مقالات قصيرة بصياغة مستقلة وروابط للمصادر. ليست نسخاً لوكالات.
        </p>
        <ul className="mb-8 space-y-4">
          {ITEMS.map((it) => (
            <li key={it.slug} className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="mb-1 text-xs font-bold text-indigo-700">{it.dateLabel}</p>
              <Link
                href={`/events/${it.slug}`}
                className="text-lg font-extrabold text-slate-900 hover:underline"
              >
                {it.title}
              </Link>
              <p className="mt-2 text-sm leading-7 text-slate-600">{it.blurb}</p>
            </li>
          ))}
        </ul>
        <p className="mb-6 text-sm">
          <Link href="/news" className="font-bold text-indigo-800 hover:underline">
            مركز الأخبار ←
          </Link>
          {" · "}
          <Link href="/editorial-policy" className="font-bold text-indigo-800 hover:underline">
            سياسة التحرير ←
          </Link>
          {" · "}
          <Link href="/prayer-times" className="font-bold text-indigo-800 hover:underline">
            مواقيت الصلاة ←
          </Link>
        </p>
        <AdSlot position="in-content" label="أسفل قائمة الأحداث" />
      </main>
    </>
  );
}
