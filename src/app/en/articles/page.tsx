import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import EnglishStoryCard from "@/components/EnglishStoryCard";
import { EN_ARTICLES } from "@/lib/enDesk";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "English how-to guides | Sham AI" },
  description: "Practical English guides with a cover image and a tool at the end.",
  alternates: { canonical: `${SITE_URL}/en/articles`, languages: { en: `${SITE_URL}/en/articles`, ar: `${SITE_URL}/articles` } },
  openGraph: { title: "English how-to guides | Sham AI", description: "Practical English guides.", url: `${SITE_URL}/en/articles`, locale: "en_US", type: "website" },
};

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="text-4xl font-black tracking-tight text-slate-950">Guides</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">A short how-to, then the browser tool. No account.</p>
      <div className="mt-6"><AdSlot position="in-content" label="English guides" /></div>
      <div className="mt-6 grid gap-4">
        {EN_ARTICLES.map((item) => (
          <EnglishStoryCard key={item.slug} href={`/en/articles/${item.slug}`} slug={item.slug} title={item.title} dek={item.dek} date={item.date} badge="Guide" />
        ))}
      </div>
    </main>
  );
}
