import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import ContentCard from "@/components/editorial/ContentCard";
import EditorialHero from "@/components/editorial/EditorialHero";
import { ARTICLE_ITEMS } from "@/lib/articlesIndex";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;
const PATH = "/articles";

export const metadata: Metadata = {
  title: "مقالات هادفة | سوق تولز",
  description:
    "مقالات عربية قصيرة تقدّم فائدة حقيقية: التحقق من الأخبار، الثقافة المالية، ووعي الإعلام — دون حشو.",
  keywords: ["مقالات عربية", "التحقق من الأخبار", "ثقافة مالية", "سوق تولز"],
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "مقالات هادفة | سوق تولز",
    description: "محتوى يقدّم قيمة للقارئ: وضوح، خطوات عملية، وخلاصات.",
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
    { "@type": "ListItem", position: 2, name: "مقالات", item: `${SITE}${PATH}` },
  ],
};

export default function ArticlesIndexPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB) }} />
      <main className="mx-auto max-w-2xl px-4 py-8" dir="rtl" lang="ar">
        <EditorialHero
          crumbs={[{ href: "/", label: "الرئيسة" }, { label: "مقالات" }]}
          title="مقالات هادفة"
          subtitle="نصوص مستقلة تركّز على الفائدة العملية والوضوح. ليست إعادة نشر لوكالات، وليست حشواً لتحسين محركات البحث فقط."
          links={[
            { href: "/news", label: "الأخبار" },
            { href: "/events", label: "الأحداث" },
            { href: "/editorial-policy", label: "سياسة التحرير" },
          ]}
        />

        <ul className="mb-8 space-y-4">
          {ARTICLE_ITEMS.map((a) => (
            <ContentCard
              key={a.slug}
              href={`/articles/${a.slug}`}
              title={a.title}
              blurb={a.description}
              dateLabel={a.dateLabel}
              badge={a.category}
              meta={`${a.readMinutes} د قراءة`}
              variant="article"
            />
          ))}
        </ul>

        <AdSlot position="in-content" label="أسفل قائمة المقالات" />

        <p className="mt-8 text-center text-sm text-slate-500">
          <Link href="/news" className="font-bold text-sky-800 hover:underline">
            مركز الأخبار
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
