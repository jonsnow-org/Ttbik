import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import { fetchNewsTicker } from "@/lib/newsRss";

const SITE = "https://souqtools.com";
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

        <article className="mb-8 rounded-2xl border border-slate-200 bg-white p-5">
          <p className="mb-1 text-xs font-bold text-indigo-700">خبر اليوم · 24 سبتمبر 2026</p>
          <h2 className="mb-3 text-lg font-extrabold text-slate-900">
            ترمب يستقبل شي في واشنطن ويدعو بوتين إلى قمة العشرين
          </h2>
          <p className="mb-3 text-sm leading-7 text-slate-700">
            ما الذي حدث: تقارير عربية موثوقة نقلت أن الرئيس الأميركي استقبل نظيره الصيني في
            زيارة دولة إلى واشنطن، في وقت أعلن فيه الجانب الأميركي دعوة الرئيس الروسي للمشاركة
            في قمة مجموعة العشرين المقررة في ميامي في ديسمبر.
          </p>
          <p className="mb-3 text-sm leading-7 text-slate-700">
            لماذا يهم: اللقاء الثلاثي المحتمل بين واشنطن وبكين وموسكو على هامش مسار قمة
            العشرين يمس ملفات التجارة والعقوبات والحرب في أوكرانيا، وهو ما يتابعه القارئ العربي
            من باب أسعار الطاقة والاستقرار الإقليمي لا من باب البروتوكول فقط.
          </p>
          <p className="mb-4 text-sm leading-7 text-slate-700">
            ماذا بعد: البرنامج الرسمي للزيارة يشمل محادثات ومأدبة ثم لقاءً لاحقاً. الدعوة إلى
            بوتين معلنة من الجانب الأميركي ولم يُنشر بعد رد رسمي روسي في المصادر أدناه.
          </p>
          <p className="text-xs font-bold text-slate-600">المصادر (فُتحت للتحقق):</p>
          <ul className="mt-1 list-disc space-y-1 pr-5 text-xs text-indigo-800">
            <li>
              <a href="https://aawsat.com/" target="_blank" rel="noopener noreferrer" className="hover:underline">
                الشرق الأوسط — عدد 24 سبتمبر 2026 (استقبال شي ودعوة بوتين لقمة العشرين)
              </a>
            </li>
            <li>
              <a
                href="https://www.alarabiya.net/latest-news"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
              >
                العربية — أخبار 24 سبتمبر 2026 (استقبال الرئيس الصيني وتمديد الهدنة التجارية)
              </a>
            </li>
          </ul>
        </article>

        <p className="mb-6 text-sm">
          <Link href="/bots" className="font-bold text-indigo-800 hover:underline">
            أدوات البوتات ←
          </Link>
        </p>
        <AdSlot position="in-content" label="أسفل مركز الأخبار" />
      </main>
    </>
  );
}
