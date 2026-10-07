import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import Tool from "@/app/free-tools/cv-generator/CvGenerator";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "Free CV Generator — No Signup | Sham AI" },
  description: "Build a one-page CV in the browser and download it.",
  alternates: {
    canonical: `${SITE_URL}/en/free-tools/cv-generator`,
    languages: { en: `${SITE_URL}/en/free-tools/cv-generator`, ar: `${SITE_URL}/free-tools/cv-generator` },
  },
};

export default function Page() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="mb-2 text-2xl font-extrabold">CV generator</h1>
      <p className="mb-4 text-sm leading-7 text-slate-600">Build a one-page CV. No account.</p>
      <AdSlot position="in-content" label="English tool" />
      <Tool />
      <AdSlot position="footer-banner" label="Below English tool" />
      <Link className="mt-4 inline-block text-sm font-bold" href="/en/free-tools">All English tools</Link>
    </main>
  );
}
