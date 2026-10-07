import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import { EN_ARTICLES } from "@/lib/enDesk";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "English how-to guides | Sham AI" },
  description: "How to calculate BMI, add VAT, make a WhatsApp link, and keep a CV to one page.",
  alternates: { canonical: `${SITE_URL}/en/articles`, languages: { en: `${SITE_URL}/en/articles` } },
};

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="text-4xl font-extrabold tracking-tight">Guides</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">How-to pages written for an English search. Each guide ends at the tool.</p>
      <AdSlot position="in-content" label="English articles" />
      <div className="mt-6 grid gap-3">
        {EN_ARTICLES.map((item) => (
          <Link key={item.slug} href={`/en/articles/${item.slug}`} className="rounded-3xl border border-slate-200 bg-white p-5">
            <p className="text-xs text-slate-400">{item.date}</p>
            <h2 className="mt-1 text-xl font-bold">{item.title}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">{item.dek}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
