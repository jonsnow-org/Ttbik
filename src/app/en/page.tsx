import type { Metadata } from "next";
import Link from "next/link";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "Sham AI English: News, Articles, Events, Tools" },
  description: "English news, how-to articles, public events, and browser tools for international search. Same section structure, separate stories.",
  alternates: { canonical: `${SITE_URL}/en`, languages: { en: `${SITE_URL}/en` } },
};

const SECTIONS = [
  ["/en/news", "News", "Short notes on tools and the open web."],
  ["/en/articles", "Articles", "How-to pages that end at a tool."],
  ["/en/events", "Events", "Public international dates with a source."],
  ["/en/free-tools", "Tools", "QR codes, short links, and image checks."],
];

export default function EnglishHome() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="mb-2 text-2xl font-extrabold">News, articles, events, and tools</h1>
      <p className="mb-6 text-sm leading-7 text-slate-600">The English desk uses the same sections as the rest of the site. The items are chosen for an international reader.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map(([href, title, text]) => (
          <Link key={href} href={href} className="rounded-3xl border border-slate-200 p-4">
            <h2 className="text-lg font-bold">{title}</h2>
            <p className="mt-1 text-sm text-slate-700">{text}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
