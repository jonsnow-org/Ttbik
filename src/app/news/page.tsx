import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import { latestNewsItem } from "@/lib/newsItems";
import { fetchNewsTicker } from "@/lib/newsRss";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;
const PATH = "/news";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "أخبار وأحداث | سوق تولز",
  description:
    "شريط عاجل من مصادر عربية موثوقة، وخبر اليوم بمصدرين على الأقل. لا نسخ للمقالات، وكل رابط يفتح المصدر الأصلي.",
  keywords: ["أخبار عربية", "خبر اليوم", "سوق تولز", "شريط عاجل"],
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "أخبار وأحداث | سوق تولز",
    description: "شريط عاجل من مصادر موثوقة وخبر اليوم بمصدرين.",
    url: `${SITE}${PATH}`,
    locale: "ar_AR",
    type: "website",
    images: [{ url: `${SITE}/opengraph-image` }],
  },
  twitter: {
    card: "summary_large_image",
    title: "أخبار وأحداث | سوق تولز",
    description: "شريط عاجل من مصادر موثوقة.",
    images: [`${SITE}/opengraph-image`],
  },
};

const BREADCRUMB = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "الرئيسة", item: SITE },
    { "@type": "ListItem", position: 2, name: "أخبار", item: `${SITE}${PATH}` },
  ],
};

export default async function NewsHubPage() {
  const ticker = await fetchNewsTicker(12);
  const updated = new Date().toISOString();
  const featured = latestNewsItem();

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
            <li className="font-semibold text-slate-800">أخبار</li>
          </ol>
        </nav>

        <h1 className="mb-2 text-2xl font-extrabold text-slate-900">مركز الأخبار والأحداث</h1>
        <p className="mb-6 text-sm leading-7 text-slate-600">
          الشريط أدناه يُحدَّث من الخادم كل عشر دقائق من موجزات رسمية. العناوين من المصدر،
          والرابط يفتح الموقع الأصلي. لا نسخ للمقالات.
        </p>

        <section className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-4" aria-label="شريط عاجل">
          <h2 className="mb-3 text-sm font-extrabold text-amber-950">عاجل من المصادر</h2>
          {ticker.length === 0 ? (
            <p className="text-sm text-slate-600">تعذّر جلب الموجز الآن. حدّث الصفحة لاحقاً.</p>
          ) : (
            <ul className="space-y-3">
              {ticker.map((item) => (
                <li key={item.link} className="text-sm leading-6">
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-slate-900 hover:underline"
                  >
                    {item.title}
                  </a>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {item.source}
                    {item.publishedAt ? ` · ${item.publishedAt}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11px] text-slate-500">آخر محاولة جلب: {updated}</p>
        </section>

        <div className="mb-8">
          <AdSlot position="in-content" label="بين الشريط العاجل وخبر اليوم" />
        </div>

        {featured ? (
          <article className="mb-8 rounded-2xl border border-slate-200 bg-white p-5">
            <p className="mb-1 text-xs font-bold text-indigo-700">خبر اليوم · {featured.dateLabel}</p>
            <h2 className="mb-3 text-lg font-extrabold text-slate-900">
              <Link href={`/news/${featured.slug}`} className="hover:underline">
                {featured.title}
              </Link>
            </h2>
            <p className="mb-3 text-sm leading-7 text-slate-700">{featured.paragraphs[0]}</p>
            <p className="text-sm">
              <Link href={`/news/${featured.slug}`} className="font-bold text-indigo-800 hover:underline">
                قراءة الخبر كاملاً ←
              </Link>
            </p>
          </article>
        ) : null}

        <p className="mb-6 text-sm">
          <Link href="/editorial-policy" className="font-bold text-indigo-800 hover:underline">
            سياسة التحرير ←
          </Link>
          {" · "}
          <Link href="/events" className="font-bold text-indigo-800 hover:underline">
            الأحداث ←
          </Link>
          {" · "}
          <Link href="/bots" className="font-bold text-indigo-800 hover:underline">
            أدوات البوتات ←
          </Link>
        </p>
        <AdSlot position="in-content" label="أسفل مركز الأخبار" />
      </main>
    </>
  );
}
