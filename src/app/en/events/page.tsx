import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import EnglishStoryCard from "@/components/EnglishStoryCard";
import { EN_EVENTS } from "@/lib/enDesk";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "International public dates in English | Sham AI" },
  description: "International dates with a public source, shown as image cards.",
  alternates: { canonical: `${SITE_URL}/en/events`, languages: { en: `${SITE_URL}/en/events`, ar: `${SITE_URL}/events` } },
  openGraph: { title: "International public dates in English | Sham AI", description: "Public dates with a source.", url: `${SITE_URL}/en/events`, locale: "en_US", type: "website" },
};

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="text-4xl font-black tracking-tight text-slate-950">Dates</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">Public dates an English search can land on. Not a local calendar.</p>
      <p className="mt-3"><Link href="/en/events/upcoming" className="rounded-full bg-sky-500 px-4 py-2 text-xs font-black text-white">Upcoming only</Link></p>
      <div className="mt-6"><AdSlot position="in-content" label="English events" /></div>
      <div className="mt-6 grid gap-4">
        {EN_EVENTS.map((item) => (
          <EnglishStoryCard key={item.slug} href={`/en/events/${item.slug}`} slug={item.slug} title={item.title} dek={item.dek} date={item.date} badge="Date" />
        ))}
      </div>
    </main>
  );
}
