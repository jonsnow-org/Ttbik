import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import ContentCard from "@/components/editorial/ContentCard";
import EditorialHero from "@/components/editorial/EditorialHero";
import EditorialHubNav from "@/components/editorial/EditorialHubNav";
import { EVENT_EXTRAS } from "@/lib/eventsExtra";
import { EVENT_ITEMS } from "@/lib/eventsIndex";
import { SITE_URL } from "@/lib/siteUrl";

const SITE = SITE_URL;
const PATH = "/events/upcoming";
export const revalidate = 300;

export const metadata: Metadata = {
  title: "الأحداث القادمة",
  description: "مناسبات وأحداث موثّقة بعد اليوم: تاريخها ومصدرها، بلا توقعات ولا إشاعات.",
  keywords: ["أحداث قادمة", "مناسبات أكتوبر", "شام AI"],
  alternates: { canonical: `${SITE}${PATH}` },
  openGraph: {
    title: "الأحداث القادمة | شام AI",
    description: "ما بعد اليوم من مناسبات موثّقة.",
    url: `${SITE}${PATH}`,
    locale: "ar_AR",
    type: "website",
    images: [{ url: `${SITE}/og/news.jpg`, width: 1200, height: 630 }],
  },
};

function istanbulToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function UpcomingEventsPage() {
  const today = istanbulToday();
  const upcoming = [...EVENT_EXTRAS, ...EVENT_ITEMS]
    .filter((e, i, all) => all.findIndex((x) => x.slug === e.slug) === i)
    .filter((e) => e.dateIso > today)
    .sort((a, b) => a.dateIso.localeCompare(b.dateIso));

  return (
    <main className="mx-auto max-w-3xl px-4 py-8" dir="rtl" lang="ar">
      <EditorialHubNav active="upcoming" />
      <EditorialHero
        crumbs={[{ href: "/", label: "الرئيسة" }, { href: "/events", label: "أحداث" }, { label: "القادمة" }]}
        title="الأحداث القادمة"
        subtitle="مناسبات بتاريخ ثابت بعد اليوم، مع مصدر كل بطاقة. لا توقع طقس ولا سعر."
        links={[
          { href: "/events", label: "كل الأحداث" },
          { href: "/news", label: "الأخبار" },
          { href: "/articles", label: "مقالات" },
        ]}
      />
      <div className="mb-6"><AdSlot position="in-content" label="أعلى الأحداث القادمة" /></div>
      {upcoming.length === 0 ? (
        <p className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm text-slate-600">لا بطاقات قادمة الآن. الأحداث المنشورة في <Link href="/events" className="font-bold text-sky-800">قسم الأحداث</Link>.</p>
      ) : (
        <ul className="space-y-4">
          {upcoming.map((e) => (
            <ContentCard
              key={e.slug}
              href={`/events/${e.slug}`}
              title={e.title}
              blurb={e.blurb}
              dateLabel={e.dateLabel}
              badge="قادم"
              badgeTone="indigo"
              imageUrl={e.imageUrl}
              imageAlt={e.title}
            />
          ))}
        </ul>
      )}
      <div className="mt-8"><AdSlot position="footer-banner" label="أسفل الأحداث القادمة" /></div>
    </main>
  );
}
