import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import { NEWS_ITEMS, getNewsItem } from "@/lib/newsItems";
import { LIVE_DESKS, liveEmbedSrc } from "@/lib/newsLive";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;

export function generateStaticParams() {
  return NEWS_ITEMS.map((n) => ({ slug: n.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const item = getNewsItem(params.slug);
  if (!item) return { title: "خبر" };
  const url = `${SITE}/news/${item.slug}`;
  const image = item.imageUrl || `${SITE}/og/news.jpg`;
  return {
    title: `${item.title} | سوق تولز`,
    description: item.description,
    alternates: { canonical: url },
    openGraph: {
      title: item.title,
      description: item.description,
      url,
      locale: "ar_AR",
      type: "article",
      images: [{ url: image, width: 1200, height: 630 }],
    },
  };
}

export default function NewsArticlePage({ params }: { params: { slug: string } }) {
  const item = getNewsItem(params.slug);
  if (!item) notFound();

  const url = `${SITE}/news/${item.slug}`;
  const image = item.imageUrl || `${SITE}/og/news.jpg`;
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "الرئيسة", item: SITE },
      { "@type": "ListItem", position: 2, name: "أخبار", item: `${SITE}/news` },
      { "@type": "ListItem", position: 3, name: item.title, item: url },
    ],
  };
  const articleLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: item.title,
    datePublished: item.dateIso,
    inLanguage: "ar",
    url,
    image,
    author: { "@type": "Organization", name: "سوق تولز" },
    publisher: { "@type": "Organization", name: "سوق تولز" },
    citation: item.sources.map((s) => s.href),
  };
  const desk = LIVE_DESKS[0];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbs) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }} />
      <main className="mx-auto max-w-2xl px-4 py-8" dir="rtl" lang="ar">
        <nav className="mb-5 text-sm text-slate-500" aria-label="مسار التنقل">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/" className="hover:text-slate-800">الرئيسة</Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href="/news" className="hover:text-slate-800">أخبار</Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-slate-800">خبر اليوم</li>
          </ol>
        </nav>

        <article className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
          <div className="relative aspect-[16/9] w-full overflow-hidden bg-slate-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt={item.title} className="h-full w-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <div className="p-5">
            <p className="mb-1 text-xs font-bold text-indigo-700">خبر اليوم · {item.dateLabel}</p>
            <h1 className="mb-4 text-2xl font-extrabold text-slate-900">{item.title}</h1>
            {item.paragraphs.map((p) => (
              <p key={p.slice(0, 28)} className="mb-3 text-sm leading-7 text-slate-700">
                {p}
              </p>
            ))}
            <p className="text-xs font-bold text-slate-600">المصادر (روابط المقالات نفسها):</p>
            <ul className="mt-1 list-disc space-y-1 pr-5 text-xs text-indigo-800">
              {item.sources.map((s) => (
                <li key={s.href}>
                  <a href={s.href} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </article>

        <section className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-slate-950" aria-label="بث رسمي">
          <div className="aspect-video w-full">
            <iframe
              title={`بث ${desk.name}`}
              src={liveEmbedSrc(desk)}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
            />
          </div>
          <p className="px-4 py-3 text-xs leading-6 text-slate-200">
            متابعة الأحداث العالمية من بث {desk.name} الرسمي. الملخص أعلاه ليس تغطية لحظة بلحظة.
          </p>
        </section>

        <div className="mt-6">
          <AdSlot position="in-content" label="أسفل الخبر" />
        </div>

        <p className="mb-6 mt-6 text-sm">
          <Link href="/news" className="font-bold text-indigo-800 hover:underline">مركز الأخبار ←</Link>
          {" · "}
          <Link href="/events" className="font-bold text-indigo-800 hover:underline">الأحداث ←</Link>
          {" · "}
          <Link href="/editorial-policy" className="font-bold text-indigo-800 hover:underline">سياسة التحرير ←</Link>
        </p>
      </main>
    </>
  );
}
