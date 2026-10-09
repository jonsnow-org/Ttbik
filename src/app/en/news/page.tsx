import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import EnglishLiveDesks from "@/components/EnglishLiveDesks";
import EnglishStoryCard from "@/components/EnglishStoryCard";
import { EN_NEWS } from "@/lib/enDesk";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "English news notes | Sham AI" },
  description: "English notes with a named source, plus official English live desks. Sham AI does not rebroadcast.",
  alternates: { canonical: `${SITE_URL}/en/news`, languages: { en: `${SITE_URL}/en/news`, ar: `${SITE_URL}/news` } },
  openGraph: { title: "English news notes | Sham AI", description: "Documented English notes and official live desks.", url: `${SITE_URL}/en/news`, locale: "en_US", type: "website" },
};

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="text-4xl font-black tracking-tight text-slate-950">News</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">A documented story, or a tool that runs in the browser. Live video is the channel's own stream.</p>
      <EnglishLiveDesks />
      <div className="mt-6"><AdSlot position="in-content" label="English news" /></div>
      <div className="mt-6 grid gap-4">
        {EN_NEWS.map((item) => (
          <EnglishStoryCard key={item.slug} href={`/en/news/${item.slug}`} slug={item.slug} title={item.title} dek={item.dek} date={item.date} badge="Note" />
        ))}
      </div>
    </main>
  );
}
