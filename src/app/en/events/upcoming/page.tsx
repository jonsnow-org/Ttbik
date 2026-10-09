import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import EnglishStoryCard from "@/components/EnglishStoryCard";
import { EN_EVENTS } from "@/lib/enDesk";
import { SITE_URL } from "@/lib/siteUrl";

export const revalidate = 300;

export const metadata: Metadata = {
  title: { absolute: "Upcoming public dates in English | Sham AI" },
  description: "Dates after today with a named public source.",
  alternates: { canonical: `${SITE_URL}/en/events/upcoming`, languages: { en: `${SITE_URL}/en/events/upcoming`, ar: `${SITE_URL}/events/upcoming` } },
  openGraph: { title: "Upcoming public dates in English | Sham AI", description: "What comes next on the English desk.", url: `${SITE_URL}/en/events/upcoming`, locale: "en_US", type: "website" },
};

function istanbulToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default function Page() {
  const today = istanbulToday();
  const upcoming = EN_EVENTS.filter((item) => item.date > today).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="text-4xl font-black tracking-tight text-slate-950">Upcoming</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">Public dates after today. Each card has a cover. No weather forecast and no price call.</p>
      <div className="mt-6"><AdSlot position="in-content" label="English upcoming" /></div>
      <div className="mt-6 grid gap-4">
        {upcoming.map((item) => (
          <EnglishStoryCard key={item.slug} href={`/en/events/${item.slug}`} slug={item.slug} title={item.title} dek={item.dek} date={item.date} badge="Upcoming" />
        ))}
      </div>
      <p className="mt-6 text-sm"><Link href="/en/events" className="font-bold text-sky-800">All dates</Link> · <Link href="/events/upcoming" className="font-bold text-sky-800">Arabic upcoming</Link></p>
    </main>
  );
}
