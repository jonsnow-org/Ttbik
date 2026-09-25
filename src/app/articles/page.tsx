import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";
import ContentCard from "@/components/editorial/ContentCard";
import EditorialHero from "@/components/editorial/EditorialHero";
import { ARTICLE_ITEMS } from "@/lib/articlesIndex";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;
const PATH = "/articles";

export const metadata: Metadata = {
  title: "مقالات مفيدة | سوق تولز",
  description:
    "مقالات عربية هادفة: محو أمية رقمية، ثقافة مالية، أمن حسابات، ومهارات عملية — قيمة حقيقية بلا حشو.",
  keywords: ["مقالات عربية", "محو الأمية الرقمية", "أمن رقمي", "سوق تولز"],
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "مقالات مفيدة | سوق تولز",
    description: "مقالات تقدّم فائدة حقيقية للقارئ.",
    url: `${SITE}${PATH}`,
    locale: "ar_AR",
    type: "website",
    images: [{ url: `${SITE}/opengraph-image` }],
  },
};

export default function ArticlesHubPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" dir="rtl" lang="ar">
      <EditorialHero
        crumbs={[{ href: "/", label: "الرئيسة" }, { label: "مقالات" }]}
        title="مقالات مفيدة"
        subtitle="محتوى يشرح مهارة أو مفهوماً بخطوات واضحة وخلاصة سريعة. لا حشو، ولا وعود كاذبة."
        links={[
          { href: "/digest", label: "ملخص اليوم" },
          { href: "/news", label: "الأخبار" },
          { href: "/events", label: "الأحداث" },
        ]}
      />

      <div className="mb-6">
        <AdSlot position="in-content" label="أعلى المقالات" />
      </div>

      <ul className="space-y-4">
        {ARTICLE_ITEMS.map((a) => (
          <ContentCard
            key={a.slug}
            href={`/articles/${a.slug}`}
            title={a.title}
            blurb={a.description}
            dateLabel={a.dateLabel}
            meta={`${a.readMinutes} د`}
            badge={a.category}
            badgeTone="emerald"
          />
        ))}
      </ul>

      <div className="mt-8">
        <AdSlot position="footer" label="أسفل المقالات" />
      </div>
    </main>
  );
}
