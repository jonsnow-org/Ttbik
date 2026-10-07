import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import Tool from "@/app/free-tools/life-counter/LifeCounter";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "Age Calculator — Exact Age | Sham AI" },
  description: "Calculate exact age from a birth date in the browser.",
  alternates: {
    canonical: `${SITE_URL}/en/free-tools/life-counter`,
    languages: { en: `${SITE_URL}/en/free-tools/life-counter`, ar: `${SITE_URL}/free-tools/life-counter` },
  },
};

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="mb-2 text-2xl font-extrabold">Age calculator</h1>
      <p className="mb-4 text-sm leading-7 text-slate-600">Exact age from a birth date. No account.</p>
      <AdSlot position="in-content" label="English tool" />
      <Tool />
      <AdSlot position="footer-banner" label="Below English tool" />
      <Link className="mt-4 inline-block text-sm font-bold" href="/en/free-tools">All English tools</Link>
    </main>
  );
}
