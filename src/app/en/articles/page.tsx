import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "How-to articles in English",
  description: "English how-to articles for searches about free browser tools, checks, and everyday calculations.",
  alternates: { canonical: `${SITE_URL}/en/articles`, languages: { en: `${SITE_URL}/en/articles` } },
};

export default function EnglishArticles() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-extrabold">Articles</h1>
      <article className="mt-6 rounded-2xl border p-4">
        <h2 className="text-xl font-bold">Check a calculation without creating an account</h2>
        <p className="mt-2 text-slate-700">A useful English article starts from the search, shows the steps, and ends at the tool. It does not retell a regional news story.</p>
        <Link className="mt-3 inline-block font-bold" href="/free-tools">Browse free tools</Link>
      </article>
    </main>
  );
}
