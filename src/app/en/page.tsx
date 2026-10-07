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
  ["/en/news", "News", "Short notes on tools and the open web.", "01"],
  ["/en/articles", "Articles", "How-to pages that end at a tool.", "02"],
  ["/en/events", "Events", "Public international dates with a source.", "03"],
  ["/en/free-tools", "Tools", "QR codes, short links, and image checks.", "04"],
];

export default function EnglishHome() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Sham AI</p>
      <h1 className="mt-2 max-w-2xl text-4xl font-extrabold tracking-tight text-slate-950">News, articles, events, and tools</h1>
      <p className="mt-3 max-w-xl text-base leading-7 text-slate-600">A clean English desk. Same sections as the site, written for an international search.</p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {SECTIONS.map(([href, title, text, index]) => (
          <Link key={href} href={href} className="group rounded-3xl border border-slate-200 bg-slate-50 p-6 transition hover:-translate-y-0.5 hover:border-slate-900 hover:bg-white">
            <span className="text-xs font-bold text-slate-400">{index}</span>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{text}</p>
            <span className="mt-4 inline-block text-sm font-bold group-hover:underline">Open</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
