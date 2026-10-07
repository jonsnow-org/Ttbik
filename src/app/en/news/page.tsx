import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "Tech news for tool searches",
  description: "English news notes on browser tools, open formats, and practical web changes. Written for international search, not translated from another desk.",
  alternates: { canonical: `${SITE_URL}/en/news`, languages: { en: `${SITE_URL}/en/news`, "x-default": `${SITE_URL}/en/news` } },
};

const ITEMS = [
  {
    href: "/en/free-tools/image-optimizer",
    title: "Smaller images before a page goes live",
    text: "A page that ships oversized images loads slowly. Compressing in the browser is the check before publish.",
  },
];

export default function EnglishNews() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="mb-2 text-2xl font-extrabold text-slate-900">News</h1>
      <p className="mb-6 text-sm leading-7 text-slate-600">Short English notes for people searching tools and web practice. The Arabic desk keeps its own headlines.</p>
      <AdSlot position="in-content" label="English section" />
      <div className="grid gap-3">
        {ITEMS.map((item) => (
          <article key={item.href} className="rounded-3xl border border-slate-200 p-4">
            <h2 className="text-lg font-bold">{item.title}</h2>
            <p className="mt-2 text-sm leading-7 text-slate-700">{item.text}</p>
            <Link className="mt-3 inline-block text-sm font-bold" href={item.href}>Open the tool</Link>
          </article>
        ))}
      </div>
          <AdSlot position="footer-banner" label="English section footer" />
    </main>
  );
}
