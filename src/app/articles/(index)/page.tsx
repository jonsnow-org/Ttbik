import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";
import ContentCard from "@/components/editorial/ContentCard";
import EditorialHero from "@/components/editorial/EditorialHero";
import EditorialHubNav from "@/components/editorial/EditorialHubNav";
import { ARTICLE_ITEMS } from "@/lib/articlesIndex";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;
const PATH = "/articles";

/** تحديث دوري + دعم /api/revalidate عند إضافة مقالات */
export const revalidate = 300;

export const metadata: Metadata = {
  title: "مقالات مفيدة",
  description:
    "مقالات عربية هادفة: محو أمية رقمية، ثقافة مالية، أمن حسابات، ومهارات عملية — قيمة حقيقية بلا حشو.",
  keywords: ["مقالات عربية", "محو الأمية الرقمية", "أمن رقمي", "شام AI"],
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "مقالات مفيدة | شام AI",
    description: "مقالات تقدّم فائدة حقيقية للقارئ.",
    url: `${SITE}${PATH}`,
    locale: "ar_AR",
    type: "website",
    images: [{ url: `${SITE}/og/cover.jpg`, width: 1200, height: 630 }],
  },
};

export default function ArticlesHubPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" dir="rtl" lang="ar">
      <EditorialHubNav active="articles" />

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
            imageUrl={a.imageUrl}
            imageAlt={a.title}
          />
        ))}
      </ul>

      <div className="mt-8">
        <AdSlot position="footer-banner" label="أسفل المقالات" />
      </div>
    </main>
  );
}
