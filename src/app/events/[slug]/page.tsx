import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;

const ARTICLE = {
  slug: "autumn-equinox-2026",
  title: "ما الذي نعرفه عن الاعتدال الخريفي 2026؟",
  dateIso: "2026-09-24",
  dateLabel: "24 سبتمبر 2026",
  description:
    "شرح موجز لموعد الاعتدال الخريفي 2026 في الدول العربية، ومدة الفصل، ولماذا لا يتطابق تساوي الليل والنهار مع اللحظة الفلكية.",
  paragraphs: [
    "ما تقوله المصادر الفلكية المنشورة هذا الأسبوع: الاعتدال الخريفي لعام 2026 وقع يوم الأربعاء 23 سبتمبر. اللحظة الفلكية كانت عند الساعة 00:05 بتوقيت غرينتش، أي 03:05 بتوقيت مكة المكرمة (نقل اليوم السابع في 24 سبتمبر رقم 03:05 عن الجمعية الفلكية بجدة منسوباً خطأً إلى توقيت غرينتش، والصحيح أنه بتوقيت مكة، وتحققنا منه بحساب فلكي مستقل). اليوم السابع نقل أيضاً عن المعهد القومي للبحوث الفلكية في مصر أن التوقيت المحلي في القاهرة صباح 23 سبتمبر، وأن فصل الخريف يستمر نحو 89 يوماً و20 ساعة قبل الانقلاب الشتوي المتوقع في 21 ديسمبر.",
    "المعنى الفلكي المتفق عليه في هذه التقارير: مركز قرص الشمس يكون عند تقاطع مسار الشمس مع خط الاستواء السماوي، فيبدأ الخريف فلكياً في النصف الشمالي (ومعظم الدول العربية) والربيع في النصف الجنوبي. بعد هذا اليوم تقصر ساعات النهار تدريجياً في النصف الشمالي حتى الانقلاب الشتوي.",
    "نقطة يجب عدم خلطها: تقارب طول الليل والنهار لا يساوي تساوياً مطلقاً في كل مدينة في نفس الدقيقة. اليوم السابع نقل عن الجمعية الفلكية بجدة أن الانكسار الجوي يجعل لحظة التساوي التام لا تطابق يوم الاعتدال في معظم الأماكن. صحيفة الخليج (16 سبتمبر 2026) ذكرت أيضاً أن انخفاض الحرارة بعد الاعتدال ليس فورياً في كل بلد عربي، بل يختلف حسب الموقع والتضاريس.",
    "لا نضيف أرقاماً للحرارة أو توقعات أمطار غير موجودة في المصادر أدناه. المقال شرح لحدث فلكي موثّق، وليس نشرة طقس.",
  ],
  faq: [
    {
      q: "متى وقع الاعتدال الخريفي 2026؟",
      a: "يوم الأربعاء 23 سبتمبر 2026. اللحظة الفلكية عند 00:05 بتوقيت غرينتش، أي 03:05 بتوقيت مكة المكرمة.",
    },
    {
      q: "متى ينتهي الخريف فلكياً هذا العام؟",
      a: "التقارير المصرية المنشورة تشير إلى استمرار الفصل حتى الانقلاب الشتوي في 21 ديسمبر 2026 تقريباً، لمدة نحو 89 يوماً و20 ساعة.",
    },
    {
      q: "هل يتساوى الليل والنهار تماماً في كل مدينة؟",
      a: "لا. المصادر نفسها توضح أن الانكسار الجوي والموقع يجعلان التساوي التقريبي لا يطابق لحظة الاعتدال في معظم الأماكن.",
    },
  ],
  sources: [
    {
      href: "https://www.youm7.com/story/2026/9/24/%D9%8A%D8%A7-%D8%A3%D9%87%D9%84%D8%A7-%D8%A8%D8%A7%D9%84%D8%AE%D8%B1%D9%8A%D9%81-%D8%A7%D9%84%D8%A7%D8%B9%D8%AA%D8%AF%D8%A7%D9%84-%D8%A7%D9%84%D8%AE%D8%B1%D9%8A%D9%81%D9%89-%D9%8A%D8%B7%D9%88%D9%89-%D8%A7%D9%84%D8%B5%D9%81%D8%AD%D8%A9-%D8%A7%D9%84%D8%A3%D8%AE%D9%8A%D8%B1%D8%A9-%D9%84%D9%81%D8%B5%D9%84-%D8%A7%D9%84%D8%B5%D9%8A%D9%81/7555541",
      label: "اليوم السابع — 24 سبتمبر 2026 (معهد الفلك + الجمعية الفلكية بجدة)",
    },
    {
      href: "https://www.youm7.com/story/2026/9/22/%D8%A7%D9%84%D9%82%D9%88%D9%85%D9%89-%D9%84%D9%84%D8%A8%D8%AD%D9%88%D8%AB-%D8%A7%D9%84%D9%81%D9%84%D9%83%D9%8A%D8%A9-%D9%8A%D9%83%D8%B4%D9%81-%D8%AA%D9%81%D8%A7%D8%B5%D9%8A%D9%84-%D8%A8%D8%AF%D8%A7%D9%8A%D8%A9-%D8%A7%D9%84%D8%AE%D8%B1%D9%8A%D9%81-%D9%88%D9%85%D9%88%D8%B9%D8%AF-%D8%A7%D9%84%D8%A7%D8%B9%D8%AA%D8%AF%D8%A7%D9%84-%D8%A7%D9%84%D8%AE%D8%B1%D9%8A%D9%81%D9%89/7554304",
      label: "اليوم السابع — 22 سبتمبر 2026 عن المعهد القومي للبحوث الفلكية",
    },
    {
      href: "https://www.alkhaleej.ae/2026-09-16/%D9%85%D9%86%D9%88%D8%B9%D8%A7%D8%AA/%D9%85%D8%AD%D8%B7%D8%A7%D8%AA/%D8%A7%D9%84%D8%B9%D8%AF-%D8%A7%D9%84%D8%AA%D9%86%D8%A7%D8%B2%D9%84%D9%8A-%D8%A7%D9%86%D8%B7%D9%84%D9%82-%D9%85%D8%AA%D9%89-%D9%8A%D8%A8%D8%AF%D8%A3-%D9%81%D8%B5%D9%84-%D8%A7%D9%84%D8%AE%D8%B1%D9%8A%D9%81-%D8%B1%D8%B3%D9%85%D9%8A%D8%A7",
      label: "صحيفة الخليج — 16 سبتمبر 2026",
    },
  ],
};

export function generateStaticParams() {
  return [{ slug: ARTICLE.slug }];
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  if (params.slug !== ARTICLE.slug) return { title: "مقال" };
  return {
    title: "الاعتدال الخريفي 2026 | سوق تولز",
    description: ARTICLE.description,
    alternates: { canonical: `${SITE}/events/${ARTICLE.slug}` },
    openGraph: {
      title: ARTICLE.title,
      description: ARTICLE.description,
      url: `${SITE}/events/${ARTICLE.slug}`,
      locale: "ar_AR",
      type: "article",
      images: [{ url: `${SITE}/opengraph-image` }],
    },
  };
}

export default function EventArticlePage({ params }: { params: { slug: string } }) {
  if (params.slug !== ARTICLE.slug) notFound();

  const articleLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: ARTICLE.title,
    datePublished: ARTICLE.dateIso,
    dateModified: ARTICLE.dateIso,
    inLanguage: "ar",
    author: { "@type": "Organization", name: "سوق تولز" },
    publisher: { "@type": "Organization", name: "سوق تولز" },
    citation: ARTICLE.sources.map((s) => s.href),
    url: `${SITE}/events/${ARTICLE.slug}`,
  };
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: ARTICLE.faq.map((f) => ({
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
      {
        "@type": "ListItem",
        position: 3,
        name: ARTICLE.title,
        item: `${SITE}/events/${ARTICLE.slug}`,
      },
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
            <li>
              <Link href="/" className="hover:text-slate-800">
                الرئيسة
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href="/events" className="hover:text-slate-800">
                أحداث
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="font-semibold text-slate-800">الاعتدال الخريفي</li>
          </ol>
        </nav>

        <article className="rounded-2xl border border-slate-200 bg-white p-5">
          <p className="mb-1 text-xs font-bold text-indigo-700">مقال · {ARTICLE.dateLabel}</p>
          <h1 className="mb-4 text-2xl font-extrabold text-slate-900">{ARTICLE.title}</h1>
          {ARTICLE.paragraphs.map((p) => (
            <p key={p.slice(0, 32)} className="mb-3 text-sm leading-7 text-slate-700">
              {p}
            </p>
          ))}
          <p className="mt-4 text-xs font-bold text-slate-600">المصادر:</p>
          <ul className="mt-1 list-disc space-y-1 pr-5 text-xs text-indigo-800">
            {ARTICLE.sources.map((s) => (
              <li key={s.href}>
                <a href={s.href} target="_blank" rel="noopener noreferrer" className="hover:underline">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </article>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <h2 className="mb-3 text-base font-extrabold text-slate-900">أسئلة قصيرة</h2>
          <dl className="space-y-3 text-sm leading-7">
            {ARTICLE.faq.map((f) => (
              <div key={f.q}>
                <dt className="font-bold text-slate-900">{f.q}</dt>
                <dd className="text-slate-700">{f.a}</dd>
              </div>
            ))}
          </dl>
        </section>

        <p className="mt-6 text-xs leading-6 text-slate-500">
          إعداد فريق التحرير بمساعدة أدوات ذكاء اصطناعي، مع ذكر المصادر.{" "}
          <Link href="/editorial-policy" className="font-bold text-indigo-800 hover:underline">
            سياسة التحرير
          </Link>
        </p>
        <p className="mb-6 mt-3 text-sm">
          <Link href="/prayer-times" className="font-bold text-indigo-800 hover:underline">
            مواقيت الصلاة ←
          </Link>
          {" · "}
          <Link href="/news" className="font-bold text-indigo-800 hover:underline">
            مركز الأخبار ←
          </Link>
        </p>
        <AdSlot position="in-content" label="أسفل مقال الأحداث" />
      </main>
    </>
  );
}
