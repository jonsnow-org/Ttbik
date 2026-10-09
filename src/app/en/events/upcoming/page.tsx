import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import { EN_EVENTS } from "@/lib/enDesk";
import { SITE_URL } from "@/lib/siteUrl";

export const revalidate = 300;

export const metadata: Metadata = {
  title: { absolute: "Upcoming public dates in English | Sham AI" },
  description: "Dates after today with a named public source: mental health, the International Day of the Girl, disaster risk, standards, and World Food Day.",
  alternates: { canonical: `${SITE_URL}/en/events/upcoming`, languages: { en: `${SITE_URL}/en/events/upcoming`, ar: `${SITE_URL}/events/upcoming` } },
  openGraph: {
    title: "Upcoming public dates in English | Sham AI",
    description: "What comes next on the English desk, with a source on each card.",
    url: `${SITE_URL}/en/events/upcoming`,
    locale: "en_US",
    type: "website",
  },
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
      <h1 className="text-4xl font-extrabold tracking-tight">Upcoming</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">Public dates after today. Each card names a source. No weather forecast and no price call.</p>
      <AdSlot position="in-content" label="English upcoming" />
      <div className="mt-6 grid gap-3">
        {upcoming.map((item) => (
          <Link key={item.slug} href={`/en/events/${item.slug}`} className="rounded-3xl border border-slate-200 bg-white p-5">
            <p className="text-xs text-slate-400">{item.date}</p>
            <h2 className="mt-1 text-xl font-bold">{item.title}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">{item.dek}</p>
          </Link>
        ))}
      </div>
      <p className="mt-6 text-sm"><Link href="/en/events" className="font-bold underline">All dates</Link> · <Link href="/events/upcoming" className="font-bold underline">Arabic upcoming</Link></p>
    </main>
  );
}
