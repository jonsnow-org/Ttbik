import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import ContentCard from "@/components/editorial/ContentCard";
import EditorialHero from "@/components/editorial/EditorialHero";
import { EVENT_ITEMS } from "@/lib/eventsIndex";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;
const PATH = "/events";

export const metadata: Metadata = {
  title: "أحداث اليوم والعالم | سوق تولز",
  description:
    "حدث يومي ومقالات قصيرة عن مناسبات عالمية وفلكية — بصياغة مستقلة وروابط للمصادر، دون نسخ الوكالات.",
  keywords: ["أحداث عالمية", "حدث اليوم", "سوق تولز", "مناسبات"],
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "أحداث اليوم والعالم | سوق تولز",
    description: "حدث يومي وشروحات قصيرة موثقة.",
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
    { "@type": "ListItem", position: 2, name: "أحداث", item: `${SITE}${PATH}` },
  ],
};

export default function EventsIndexPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB) }} />
      <main className="mx-auto max-w-2xl px-4 py-8" dir="rtl" lang="ar">
        <EditorialHero
          crumbs={[{ href: "/", label: "الرئيسة" }, { label: "أحداث" }]}
          title="أحداث ومناسبات"
          subtitle="كل يوم نسلّط الضوء على مناسبة أو حدث يمكن شرحه بوضوح للقارئ العربي — مع مصادر عند الحاجة ودون مبالغة."
          links={[
            { href: "/news", label: "الأخبار العاجلة" },
            { href: "/articles", label: "مقالات هادفة" },
            { href: "/editorial-policy", label: "سياسة التحرير" },
          ]}
        />

        <ul className="mb-8 space-y-4">
          {EVENT_ITEMS.map((it) => (
            <ContentCard
              key={it.slug}
              href={`/events/${it.slug}`}
              title={it.title}
              blurb={it.blurb}
              dateLabel={it.dateLabel}
              badge={it.badge || "حدث"}
              variant="event"
            />
          ))}
        </ul>

        <AdSlot position="in-content" label="أسفل قائمة الأحداث" />

        <p className="mt-8 text-center text-sm text-slate-500">
          <Link href="/news" className="font-bold text-indigo-800 hover:underline">
            مركز الأخبار
          </Link>
          {" · "}
          <Link href="/articles" className="font-bold text-indigo-800 hover:underline">
            المقالات
          </Link>
          {" · "}
          <Link href="/prayer-times" className="font-bold text-indigo-800 hover:underline">
            مواقيت الصلاة
          </Link>
        </p>
      </main>
    </>
  );
}
