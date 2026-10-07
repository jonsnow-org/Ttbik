import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import Tool from "@/app/free-tools/profit-margin/ProfitMarginCalculator";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "Profit Margin Calculator — Free | Sham AI" },
  description: "Find margin and markup from cost and selling price. Runs in the browser.",
  alternates: {
    canonical: `${SITE_URL}/en/free-tools/profit-margin`,
    languages: { en: `${SITE_URL}/en/free-tools/profit-margin`, ar: `${SITE_URL}/free-tools/profit-margin` },
  },
};

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="mb-2 text-2xl font-extrabold">Profit margin calculator</h1>
      <p className="mb-4 text-sm leading-7 text-slate-600">Turn cost and price into margin. No account.</p>
      <AdSlot position="in-content" label="English tool" />
      <Tool />
      <AdSlot position="footer-banner" label="Below English tool" />
      <Link className="mt-4 inline-block text-sm font-bold" href="/en/free-tools">All English tools</Link>
    </main>
  );
}
