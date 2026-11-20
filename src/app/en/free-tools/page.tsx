import type { Metadata } from "next";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import EnToolList from "@/components/EnToolList";
import { EN_FREE_TOOLS } from "@/lib/enFreeTools";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "Free browser tools with no signup | Sham AI" },
  description: "English tools that run in the browser: QR codes, short links, BMI, VAT, invoices, CVs, and image checks. No account and no upload required.",
  alternates: { canonical: `${SITE_URL}/en/free-tools`, languages: { en: `${SITE_URL}/en/free-tools`, ar: `${SITE_URL}/tools` } },
  openGraph: { title: "Free browser tools with no signup | Sham AI", description: "English tools that run in the browser.", url: `${SITE_URL}/en/free-tools`, locale: "en_US", type: "website" },
};

export default function EnglishTools() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="text-4xl font-black tracking-tight text-slate-950">Tools</h1>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">Sixteen browser tools for English searches. No account. A file you check stays in the tab.</p>
      <div className="mt-6"><EnToolList tools={EN_FREE_TOOLS.map((tool) => ({ href: tool.href, title: tool.title, text: tool.text }))} /></div>
    </main>
  );
}
