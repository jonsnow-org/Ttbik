import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "English desk: news, articles, events",
  description: "English pages for global readers: practical news, how-to articles, and public events. Not a translation of the Arabic desk.",
  alternates: { canonical: `${SITE_URL}/en`, languages: { en: `${SITE_URL}/en`, ar: SITE_URL } },
};

export default function EnglishHome() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Sham AI English</p>
      <h1 className="mt-2 text-3xl font-extrabold">News, articles, and events for English search</h1>
      <p className="mt-3 text-slate-600">Same site structure as the Arabic desk. The stories here are chosen for an international reader.</p>
      <div className="mt-6 grid gap-3">
        <Link className="rounded-2xl border p-4 font-bold" href="/en/news">News</Link>
        <Link className="rounded-2xl border p-4 font-bold" href="/en/articles">Articles</Link>
        <Link className="rounded-2xl border p-4 font-bold" href="/en/events">Events</Link>
        <Link className="rounded-2xl border p-4 font-bold" href="/free-tools">Free tools</Link>
      </div>
    </main>
  );
}
