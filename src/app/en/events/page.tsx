import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import { EN_EVENTS } from "@/lib/enDesk";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "International public dates in English | Sham AI" },
  description: "International dates with a public source: World Standards Day, Public Domain Day, and Safer Internet Day. Written for an English search, not a local calendar.",
  alternates: { canonical: `${SITE_URL}/en/events`, languages: { en: `${SITE_URL}/en/events` } },
  openGraph: { title: "International public dates in English | Sham AI", description: "International dates with a public source: World Standards Day, Public Domain Day, and Safer Internet Day. Written for an English search, not a local calendar.", url: `${SITE_URL}/en/events`, locale: "en_US", type: "website" },
};

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="text-4xl font-extrabold tracking-tight">Dates</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">Public dates an English search can land on. Not a local calendar.</p>
      <AdSlot position="in-content" label="English events" />
      <div className="mt-6 grid gap-3">
        {EN_EVENTS.map((item) => (
          <Link key={item.slug} href={`/en/events/${item.slug}`} className="rounded-3xl border border-slate-200 bg-white p-5">
            <p className="text-xs text-slate-400">{item.date}</p>
            <h2 className="mt-1 text-xl font-bold">{item.title}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">{item.dek}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
