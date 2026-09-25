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
  title: "أحداث عالمية | سوق تولز",
  description:
    "حدث عالمي كل يوم: مناسبات فلكية وثقافية موثّقة بمصادر، مع أسئلة شائعة وملخص واضح بالعربية.",
  keywords: ["أحداث عالمية", "حدث اليوم", "سوق تولز", "مناسبات"],
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "أحداث عالمية | سوق تولز",
    description: "حدث عالمي موثّق كل يوم.",
    url: `${SITE}${PATH}`,
    locale: "ar_AR",
    type: "website",
    images: [{ url: `${SITE}/opengraph-image` }],
  },
};

export default function EventsHubPage() {
  const featured = EVENT_ITEMS[0];
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" dir="rtl" lang="ar">
      <EditorialHero
        crumbs={[{ href: "/", label: "الرئيسة" }, { label: "أحداث" }]}
        title="أحداث عالمية"
        subtitle="كل يوم حدث موثّق: مناسبة عالمية أو فلكية أو ثقافية، بملخص عربي ومصادر وأسئلة شائعة — لا إشاعات."
        links={[
          { href: "/digest", label: "ملخص اليوم" },
          { href: "/news", label: "الأخبار" },
          { href: "/articles", label: "مقالات" },
        ]}
      />

      {featured && (
        <section className="mb-8 overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-l from-indigo-50 via-white to-sky-50 shadow-sm">
          <div className="p-5 sm:p-6">
            <p className="text-[11px] font-black tracking-wide text-indigo-600">حدث اليوم</p>
            <h2 className="mt-1 text-xl font-black text-slate-900 sm:text-2xl">
              <Link href={`/events/${featured.slug}`} className="hover:text-sky-800">{featured.title}</Link>
            </h2>
            <p className="mt-2 text-sm leading-7 text-slate-600">{featured.blurb}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`/events/${featured.slug}`} className="rounded-full bg-sky-500 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-sky-600">
                اقرأ التغطية كاملة
              </Link>
              <span className="rounded-full bg-white px-3 py-2 text-[11px] font-bold text-slate-500 ring-1 ring-slate-100">{featured.dateLabel}</span>
            </div>
          </div>
        </section>
      )}

      <div className="mb-6">
        <AdSlot position="in-content" label="أعلى قائمة الأحداث" />
      </div>

      <ul className="space-y-4">
        {EVENT_ITEMS.map((e) => (
          <ContentCard
            key={e.slug}
            href={`/events/${e.slug}`}
            title={e.title}
            blurb={e.blurb}
            dateLabel={e.dateLabel}
            badge={e.category || "حدث"}
            badgeTone="indigo"
          />
        ))}
      </ul>

      <div className="mt-8">
        <AdSlot position="footer" label="أسفل الأحداث" />
      </div>
    </main>
  );
}
