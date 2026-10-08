import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import { EN_ARTICLES, EN_EVENTS, EN_NEWS } from "@/lib/enDesk";
import { EN_FREE_TOOLS } from "@/lib/enFreeTools";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "Sham AI English: free tools, guides, and public dates" },
  description: "English desk for browser tools, how-to guides, and public dates. QR codes, VAT, BMI, invoices, and short links. No account required to use them.",
  alternates: { canonical: `${SITE_URL}/en`, languages: { en: `${SITE_URL}/en`, ar: SITE_URL } },
  openGraph: { title: "Sham AI English: free tools, guides, and public dates", description: "English desk for browser tools, how-to guides, and public dates. QR codes, VAT, BMI, invoices, and short links. No account required to use them.", url: `${SITE_URL}/en`, locale: "en_US", type: "website" },
};

export default function EnglishHome() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Sham AI · English desk</p>
      <h1 className="mt-2 max-w-3xl text-4xl font-extrabold tracking-tight text-slate-950">Tools and guides for a search that wants an answer</h1>
      <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">QR codes, tax, BMI, invoices, and short links. Each page is written in English and ends at a tool that runs in the browser.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        {[
          ["/en/news", "News", String(EN_NEWS.length)],
          ["/en/articles", "Guides", String(EN_ARTICLES.length)],
          ["/en/events", "Dates", String(EN_EVENTS.length)],
          ["/en/free-tools", "Tools", String(EN_FREE_TOOLS.length)],
        ].map(([href, label, count]) => (
          <Link key={href} href={href} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-2xl font-extrabold">{count}</p>
            <p className="text-sm font-bold">{label}</p>
          </Link>
        ))}
      </div>
      <AdSlot position="in-content" label="English home" />
      <section className="mt-8">
        <h2 className="text-xl font-extrabold">Latest notes</h2>
        <div className="mt-3 grid gap-3">
          {EN_NEWS.slice(0, 3).map((item) => (
            <Link key={item.slug} href={`/en/news/${item.slug}`} className="rounded-3xl border border-slate-200 bg-white p-5">
              <p className="text-xs text-slate-400">{item.date}</p>
              <h3 className="mt-1 text-lg font-bold">{item.title}</h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">{item.dek}</p>
            </Link>
          ))}
        </div>
      </section>
      <section className="mt-8">
        <h2 className="text-xl font-extrabold">Start with a tool</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {EN_FREE_TOOLS.slice(0, 6).map((tool) => (
            <Link key={tool.href} href={tool.href} className="rounded-3xl border border-slate-200 p-4 hover:border-slate-900">
              <h3 className="font-bold">{tool.title}</h3>
              <p className="mt-1 text-sm text-slate-600">{tool.text}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
