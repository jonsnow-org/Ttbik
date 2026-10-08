import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import { EN_NEWS } from "@/lib/enDesk";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "English tech news and browser tool notes | Sham AI" },
  description: "Documented English notes for a global reader: Nobel literature 2026, browser tools, QR codes, short links, and tax-inclusive prices. Sources named.",
  alternates: { canonical: `${SITE_URL}/en/news`, languages: { en: `${SITE_URL}/en/news` } },
  openGraph: { title: "English tech news and browser tool notes | Sham AI", description: "Documented English notes for a global reader: Nobel literature 2026, browser tools, QR codes, short links, and tax-inclusive prices. Sources named.", url: `${SITE_URL}/en/news`, locale: "en_US", type: "website" },
};

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="text-4xl font-extrabold tracking-tight">News</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">Notes for an English search: a documented story, or a tool that runs in the browser.</p>
      <AdSlot position="in-content" label="English news" />
      <div className="mt-6 grid gap-3">
        {EN_NEWS.map((item) => (
          <Link key={item.slug} href={`/en/news/${item.slug}`} className="rounded-3xl border border-slate-200 bg-white p-5">
            <p className="text-xs text-slate-400">{item.date}</p>
            <h2 className="mt-1 text-xl font-bold">{item.title}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">{item.dek}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
