import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import EnglishLiveDesks from "@/components/EnglishLiveDesks";
import EnglishStoryCard from "@/components/EnglishStoryCard";
import { EN_ARTICLES, EN_EVENTS, EN_NEWS } from "@/lib/enDesk";
import { EN_FREE_TOOLS } from "@/lib/enFreeTools";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "Sham AI English: free tools, guides, and public dates" },
  description: "English desk for browser tools, how-to guides, and public dates. QR codes, VAT, BMI, invoices, and short links. No account required to use them.",
  alternates: { canonical: `${SITE_URL}/en`, languages: { en: `${SITE_URL}/en`, ar: SITE_URL } },
  openGraph: { title: "Sham AI English: free tools, guides, and public dates", description: "English desk for browser tools, how-to guides, and public dates.", url: `${SITE_URL}/en`, locale: "en_US", type: "website", images: [{ url: `${SITE_URL}/og/news.jpg`, width: 1200, height: 630 }] },
};

export default function EnglishHome() {
  const lead = EN_NEWS[0];
  return (
    <main className="mx-auto max-w-5xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <section className="overflow-hidden rounded-3xl border border-sky-100 bg-gradient-to-l from-sky-50 via-white to-indigo-50 shadow-sm">
        <div className="grid gap-0 sm:grid-cols-2">
          <img src="https://images.unsplash.com/photo-1504711434969-e33886168f5c?auto=format&fit=crop&w=1400&q=80" alt="" className="h-52 w-full object-cover sm:h-full" />
          <div className="p-5 sm:p-7">
            <p className="text-[11px] font-black uppercase tracking-wide text-sky-700">Sham AI · English desk</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">Tools and guides for a search that wants an answer</h1>
            <p className="mt-3 text-sm leading-7 text-slate-600">QR codes, tax, BMI, invoices, and short links. Each page is in English and ends at a tool that runs in the browser.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/en/news" className="rounded-full bg-sky-500 px-4 py-2 text-xs font-black text-white hover:bg-sky-600">News</Link>
              <Link href="/en/events/upcoming" className="rounded-full bg-white px-4 py-2 text-xs font-black text-sky-800 ring-1 ring-sky-100">Upcoming dates</Link>
            </div>
          </div>
        </div>
      </section>
      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        {[
          ["/en/news", "News", String(EN_NEWS.length)],
          ["/en/articles", "Guides", String(EN_ARTICLES.length)],
          ["/en/events", "Dates", String(EN_EVENTS.length)],
          ["/en/free-tools", "Tools", String(EN_FREE_TOOLS.length)],
        ].map(([href, label, count]) => (
          <Link key={href} href={href} className="rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sky-950">
            <p className="text-2xl font-extrabold">{count}</p>
            <p className="text-sm font-bold">{label}</p>
          </Link>
        ))}
      </div>
      <EnglishLiveDesks />
      <div className="mt-6"><AdSlot position="in-content" label="English home" /></div>
      <section className="mt-8">
        <h2 className="text-xl font-black text-slate-900">Latest notes</h2>
        <div className="mt-3 grid gap-4">
          {EN_NEWS.slice(0, 3).map((item) => (
            <EnglishStoryCard key={item.slug} href={`/en/news/${item.slug}`} slug={item.slug} title={item.title} dek={item.dek} date={item.date} badge="News" />
          ))}
        </div>
      </section>
      {lead && <p className="mt-3 text-xs text-slate-500">Lead story: {lead.title}</p>}
      <section className="mt-8">
        <h2 className="text-xl font-black text-slate-900">Start with a tool</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {EN_FREE_TOOLS.slice(0, 6).map((tool) => (
            <Link key={tool.href} href={tool.href} className="rounded-3xl border border-sky-100 bg-white p-4 shadow-sm hover:border-sky-300">
              <h3 className="font-bold text-slate-900">{tool.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{tool.text}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
