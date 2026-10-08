import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import { EN_FREE_TOOLS } from "@/lib/enFreeTools";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "Free browser tools with no signup | Sham AI" },
  description: "English tools that run in the browser: QR codes, short links, BMI, VAT, invoices, CVs, and image checks. No account and no upload required.",
  alternates: { canonical: `${SITE_URL}/en/free-tools`, languages: { en: `${SITE_URL}/en/free-tools`, ar: `${SITE_URL}/free-tools` } },
  openGraph: { title: "Free browser tools with no signup | Sham AI", description: "English tools that run in the browser: QR codes, short links, BMI, VAT, invoices, CVs, and image checks. No account and no upload required.", url: `${SITE_URL}/en/free-tools`, locale: "en_US", type: "website" },
};

export default function EnglishTools() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="text-4xl font-extrabold tracking-tight">Tools</h1>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">Eleven browser tools for English searches. No account. A file you check stays in the tab.</p>
      <AdSlot position="in-content" label="English tools" />
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {EN_FREE_TOOLS.map((tool) => (
          <Link key={tool.href} href={tool.href} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-900">
            <h2 className="text-lg font-bold">{tool.title}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-700">{tool.text}</p>
          </Link>
        ))}
      </div>
      <p className="mt-8 text-sm text-slate-500">Guides for these tools live under <Link className="font-bold" href="/en/articles">Articles</Link>.</p>
    </main>
  );
}
