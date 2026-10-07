import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import Tool from "@/app/free-tools/bmi-calculator/BmiCalculator";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "Free BMI Calculator — No Signup | Sham AI" },
  description: "Calculate body mass index from height and weight in your browser. No account.",
  alternates: {
    canonical: `${SITE_URL}/en/free-tools/bmi-calculator`,
    languages: { en: `${SITE_URL}/en/free-tools/bmi-calculator`, ar: `${SITE_URL}/free-tools/bmi-calculator` },
  },
};

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="mb-2 text-2xl font-extrabold">BMI calculator</h1>
      <p className="mb-4 text-sm leading-7 text-slate-600">Check BMI from height and weight. No account.</p>
      <AdSlot position="in-content" label="English tool" />
      <Tool />
      <AdSlot position="footer-banner" label="Below English tool" />
      <Link className="mt-4 inline-block text-sm font-bold" href="/en/free-tools">All English tools</Link>
    </main>
  );
}
