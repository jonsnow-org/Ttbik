import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import { SITE_URL } from "@/lib/siteUrl";
import { EN_FREE_TOOLS } from "@/lib/enFreeTools";

export const metadata: Metadata = {
  title: { absolute: "Free Browser Tools — No Signup | Sham AI" },
  description: "English browser tools for QR codes, short links, and image size checks. No account, no upload required.",
  alternates: { canonical: `${SITE_URL}/en/free-tools`, languages: { en: `${SITE_URL}/en/free-tools` } },
};

export default function EnglishTools() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="mb-2 text-4xl font-extrabold tracking-tight">Tools</h1>
      <p className="mb-6 text-sm leading-7 text-slate-600">Browser tools for English searches. Each one runs without an account.</p>
      <AdSlot position="in-content" label="English section" />
      <div className="grid gap-3">
        {EN_FREE_TOOLS.map((tool) => (
          <Link key={tool.href} href={tool.href} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-bold">{tool.title}</h2>
            <p className="mt-1 text-sm text-slate-700">{tool.text}</p>
          </Link>
        ))}
      </div>
          <AdSlot position="footer-banner" label="English section footer" />
    </main>
  );
}
