import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import { EVENT_ITEMS, getEvent } from "@/lib/eventsIndex";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;

export function generateStaticParams() {
  return EVENT_ITEMS.map((e) => ({ slug: e.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const e = getEvent(params.slug);
  if (!e) return { title: "حدث" };
  return {
    title: `${e.title} | سوق تولز`,
    description: e.description,
    alternates: { canonical: `${SITE}/events/${e.slug}` },
    openGraph: {
      title: e.title,
      description: e.description,
      url: `${SITE}/events/${e.slug}`,
      locale: "ar_AR",
      type: "article",
      images: [{ url: `${SITE}/opengraph-image` }],
    },
  };
}

export default function EventArticlePage({ params }: { params: { slug: string } }) {
  const e = getEvent(params.slug);
  if (!e) notFound();

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: e.title,
    datePublished: e.dateIso,
    dateModified: e.dateIso,
    inLanguage: "ar",
    description: e.description,
    author: { "@type": "Organization", name: "سوق تولز" },
    publisher: { "@type": "Organization", name: "سوق تولز" },
    citation: e.sources.map((s) => s.href),
    url: `${SITE}/events/${e.slug}`,
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: e.faq.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسة", item: SITE },
      { "@type": "ListItem", position: 2, name: "أحداث", item: `${SITE}/events` },
      { "@type": "ListItem", position: 3, name: e.title, item: `${SITE}/events/${e.slug}` },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <main className="mx-auto max-w-2xl px-4 py-8" dir="rtl" lang="ar">
        <nav className="mb-5 text-sm text-slate-500" aria-label="مسار التنقل">
          <ol className="flex flex-wrap items-center gap-1">
            <li><Link href="/" className="hover:text-slate-800">الرئيسة</Link></li>
            <li aria-hidden="true">/</li>
            <li><Link href="/events" className="hover:text-slate-800">أحداث</Link></li>
            <li aria-hidden="true">/</li>
            <li className="line-clamp-1 font-semibold text-slate-800">{e.title}</li>
          </ol>
        </nav>

        <article className="overflow-hidden rounded-3xl border border-sky-100 bg-white shadow-sm">
          <div className="h-2 bg-gradient-to-l from-sky-500 to-indigo-500" />
          <div className="p-5 sm:p-7">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-bold">
              {e.category && (
                <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-indigo-800 ring-1 ring-indigo-100">{e.category}</span>
              )}
              <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-sky-800 ring-1 ring-sky-100">حدث</span>
              <span className="text-slate-500">{e.dateLabel}</span>
            </div>
            <h1 className="text-2xl font-black leading-10 text-slate-900 sm:text-[1.7rem]">{e.title}</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600">{e.description}</p>
            <div className="my-6 border-t border-slate-100" />
            <div className="space-y-4 text-[15px] leading-8 text-slate-800">
              {e.paragraphs.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            <p className="mt-6 text-xs font-bold text-slate-600">المصادر:</p>
            <ul className="mt-1 list-disc space-y-1 pr-5 text-xs text-sky-800">
              {e.sources.map((s) => (
                <li key={s.href}>
                  <a href={s.href} target="_blank" rel="noopener noreferrer" className="hover:underline">{s.label}</a>
                </li>
              ))}
            </ul>
          </div>
        </article>

        <div className="mt-6">
          <AdSlot position="in-content" label="بين المقال والأسئلة" />
        </div>

        <section className="mt-6 rounded-3xl border border-sky-100 bg-gradient-to-b from-sky-50/80 to-white p-5 shadow-sm">
          <h2 className="mb-3 text-base font-extrabold text-slate-900">أسئلة قصيرة</h2>
          <dl className="space-y-4 text-sm leading-7">
            {e.faq.map((f) => (
              <div key={f.q} className="rounded-2xl border border-white bg-white/80 p-3">
                <dt className="font-bold text-slate-900">{f.q}</dt>
                <dd className="mt-1 text-slate-700">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="mt-6 text-xs leading-6 text-slate-500">
          إعداد فريق التحرير بمساعدة أدوات ذكاء اصطناعي، مع ذكر المصادر.{" "}
          <Link href="/editorial-policy" className="font-bold text-sky-800 hover:underline">سياسة التحرير</Link>
        </p>
        <p className="mb-6 mt-3 text-sm">
          <Link href="/events" className="font-bold text-sky-800 hover:underline">← كل الأحداث</Link>
          {" · "}
          <Link href="/digest" className="font-bold text-sky-800 hover:underline">ملخص اليوم</Link>
          {" · "}
          <Link href="/news" className="font-bold text-sky-800 hover:underline">الأخبار</Link>
        </p>
      </main>
    </>
  );
}
