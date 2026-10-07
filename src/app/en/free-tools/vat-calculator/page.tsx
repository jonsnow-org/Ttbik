import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import Tool from "@/app/free-tools/vat-calculator/VatCalculator";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "VAT Calculator — Add or Remove Tax | Sham AI" },
  description: "Add or remove VAT from a price in the browser. No signup.",
  alternates: {
    canonical: `${SITE_URL}/en/free-tools/vat-calculator`,
    languages: { en: `${SITE_URL}/en/free-tools/vat-calculator`, ar: `${SITE_URL}/free-tools/vat-calculator` },
  },
};

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="mb-2 text-2xl font-extrabold">VAT calculator</h1>
      <p className="mb-4 text-sm leading-7 text-slate-600">Add or remove tax from a price. No account.</p>
      <AdSlot position="in-content" label="English tool" />
      <Tool />
      <AdSlot position="footer-banner" label="Below English tool" />
      <Link className="mt-4 inline-block text-sm font-bold" href="/en/free-tools">All English tools</Link>
    </main>
  );
}
