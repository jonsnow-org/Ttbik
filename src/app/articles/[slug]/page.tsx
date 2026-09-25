import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import { ARTICLE_ITEMS, getArticle } from "@/lib/articlesIndex";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;

export function generateStaticParams() {
  return ARTICLE_ITEMS.map((a) => ({ slug: a.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const a = getArticle(params.slug);
  if (!a) return { title: "مقال" };
  return {
    title: `${a.title} | سوق تولز`,
    description: a.description,
    alternates: { canonical: `${SITE}/articles/${a.slug}` },
    openGraph: {
      title: a.title,
      description: a.description,
      url: `${SITE}/articles/${a.slug}`,
      locale: "ar_AR",
      type: "article",
      images: [{ url: `${SITE}/opengraph-image` }],
    },
  };
}

export default function ArticlePage({ params }: { params: { slug: string } }) {
  const a = getArticle(params.slug);
  if (!a) notFound();

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: a.title,
    datePublished: a.dateIso,
    dateModified: a.dateIso,
    inLanguage: "ar",
    description: a.description,
    author: { "@type": "Organization", name: "سوق تولز" },
    publisher: { "@type": "Organization", name: "سوق تولز" },
    url: `${SITE}/articles/${a.slug}`,
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }} />
      <main className="mx-auto max-w-2xl px-4 py-8" dir="rtl" lang="ar">
        <nav className="mb-5 text-sm text-slate-500" aria-label="مسار التنقل">
          <ol className="flex flex-wrap items-center gap-1">
            <li>
              <Link href="/" className="hover:text-slate-800">
                الرئيسة
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href="/articles" className="hover:text-slate-800">
                مقالات
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-slate-800 line-clamp-1">{a.title}</li>
          </ol>
        </nav>

        <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-bold">
            <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-emerald-800 ring-1 ring-emerald-100">
              {a.category}
            </span>
            <span className="text-slate-500">{a.dateLabel}</span>
            <span className="text-slate-400">· {a.readMinutes} د قراءة</span>
          </div>
          <h1 className="text-2xl font-black leading-10 text-slate-900 sm:text-[1.7rem]">{a.title}</h1>
          <p className="mt-3 text-sm leading-7 text-slate-600">{a.description}</p>

          <div className="my-6 border-t border-slate-100" />

          <div className="space-y-4 text-[15px] leading-8 text-slate-800">
            {a.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>

          {a.takeaways?.length > 0 && (
            <div className="mt-8 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
              <p className="mb-2 text-sm font-black text-emerald-900">خلاصة سريعة</p>
              <ul className="list-disc space-y-1 pr-5 text-sm leading-7 text-emerald-950">
                {a.takeaways.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </div>
          )}

          {a.sources && a.sources.length > 0 && (
            <div className="mt-8">
              <p className="mb-2 text-sm font-black text-slate-900">مصادر ومراجع</p>
              <ul className="space-y-2 text-sm">
                {a.sources.map((s) => (
                  <li key={s.href}>
                    <a href={s.href} target="_blank" rel="noopener noreferrer" className="font-bold text-sky-800 hover:underline">
                      {s.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </article>

        <div className="mt-6">
          <AdSlot position="in-content" label="بعد المقال" />
        </div>

        <p className="mt-8 text-sm">
          <Link href="/articles" className="font-bold text-sky-800 hover:underline">
            ← كل المقالات
          </Link>
          {" · "}
          <Link href="/news" className="font-bold text-sky-800 hover:underline">
            الأخبار
          </Link>
          {" · "}
          <Link href="/events" className="font-bold text-sky-800 hover:underline">
            الأحداث
          </Link>
        </p>
      </main>
    </>
  );
}
