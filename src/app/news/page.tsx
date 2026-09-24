import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
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

const FEATURED = {
  dateLabel: "24 سبتمبر 2026",
  dateIso: "2026-09-24",
  title: "القمة المقبلة بين ترمب وشي في واشنطن: اللقاء مقرر الخميس",
  paragraphs: [
    "ما تقوله المصادر: بي بي سي عربي وصفت اللقاء بأنه قمة مقبلة بين الرئيس الأميركي دونالد ترمب والرئيس الصيني شي جينبينغ، وذكرت أن الرجلين التقيا منتصف مايو/أيار الماضي عندما زار ترمب الصين، وأن زيارة شي ردّ على تلك الزيارة.",
    "الجزيرة نت (23 سبتمبر 2026) كتبت أن شي يصل واشنطن هذا الأسبوع في أول زيارة له إلى العاصمة الأميركية منذ 11 عاماً، وأن اللقاء وجهاً لوجه مقرر الخميس، في ثاني لقاء بينهما هذا العام، وسط ملفات التجارة والذكاء الاصطناعي والمعادن الحيوية وإيران وتايوان.",
    "لا نذكر دعوة إلى قمة العشرين أو أي طرف ثالث: لم يفتح أي مصدر أدناه مقالاً يؤكد ذلك.",
  ],
  sources: [
    {
      href: "https://www.bbc.com/arabic/articles/cq5yjz0512ryo",
      label: "بي بي سي عربي — ما الذي سيجري في القمة المقبلة بين ترامب وشي جينبينغ؟",
    },
    {
      href: "https://www.aljazeera.net/politics/2026/9/23/%d8%aa%d8%b1%d9%85%d8%a8-%d9%88%d8%b4%d9%8a-%d9%82%d9%85%d8%a9-%d9%85%d8%b9%d8%b1%d9%83%d8%a9-%d8%a7%d9%84%d8%b3%d8%ac%d8%a7%d8%af%d8%a9-%d8%a7%d9%84%d8%ad%d9%85%d8%b1%d8%a7%d8%a1-%d9%886",
      label: "الجزيرة نت — ترمب وشي.. قمة معركة السجادة الحمراء و6 ملفات",
    },
  ],
};

const NEWS_ARTICLE = {
  "@context": "https://schema.org",
  "@type": "NewsArticle",
  headline: FEATURED.title,
  datePublished: FEATURED.dateIso,
  inLanguage: "ar",
  url: `${SITE}${PATH}`,
  author: { "@type": "Organization", name: "سوق تولز" },
  citation: FEATURED.sources.map((s) => s.href),
};

export default async function NewsHubPage() {
  const ticker = await fetchNewsTicker(12);
  const updated = new Date().toISOString();

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(NEWS_ARTICLE) }}
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

        <article className="mb-8 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="mb-1 text-xs font-bold text-indigo-700">خبر اليوم · {FEATURED.dateLabel}</p>
          <h2 className="mb-3 text-lg font-extrabold text-slate-900">{FEATURED.title}</h2>
          {FEATURED.paragraphs.map((p) => (
            <p key={p.slice(0, 24)} className="mb-3 text-sm leading-7 text-slate-700">
              {p}
            </p>
          ))}
          <p className="text-xs font-bold text-slate-600">المصادر (روابط المقالات نفسها):</p>
          <ul className="mt-1 list-disc space-y-1 pr-5 text-xs text-indigo-800">
            {FEATURED.sources.map((s) => (
              <li key={s.href}>
                <a href={s.href} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </article>

        <p className="mb-6 text-sm">
          <Link href="/editorial-policy" className="font-bold text-indigo-800 hover:underline">
            سياسة التحرير ←
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
