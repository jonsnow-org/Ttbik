import type { Metadata } from "next";
import Link from "next/link";
import AIToolsDirectory from "@/components/AIToolsDirectory";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: { absolute: "AI Tools Directory | Sham AI" },
  description: "Explore a curated set of AI tools for writing, image generation, video, coding, research, productivity, design, and marketing.",
  alternates: {
    canonical: `${SITE_URL}/en/ai-tools`,
    languages: { ar: `${SITE_URL}/ai-tools`, en: `${SITE_URL}/en/ai-tools` },
  },
  openGraph: {
    title: "AI Tools Directory | Sham AI",
    description: "Search a curated directory of AI tools by use case, with direct links to official websites.",
    url: `${SITE_URL}/en/ai-tools`,
    locale: "en_US",
    type: "website",
  },
};

export default function AIToolsPageEnglish() {
  return (
    <main lang="en" dir="ltr" className="mx-auto max-w-6xl px-4 py-7 sm:py-10">
      <nav aria-label="Breadcrumb" className="mb-5 text-xs font-semibold text-slate-500">
        <Link href="/en" className="hover:text-indigo-700">Sham AI</Link>
        <span className="mx-2" aria-hidden="true">/</span>
        <span className="text-slate-800">AI tools directory</span>
      </nav>

      <section className="relative overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-950 via-slate-900 to-sky-950 p-5 text-white shadow-lg sm:p-8">
        <div className="absolute -right-12 -top-16 h-48 w-48 rounded-full bg-sky-400/10 blur-2xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold text-sky-100">Independent directory · 8 categories</span>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">AI Tools Directory</h1>
            <p className="mt-3 text-sm leading-7 text-slate-200 sm:text-base">
              Explore tools for writing, images, video, coding, research, productivity, design, and marketing. Search by purpose and visit each provider's official website.
            </p>
          </div>
          <Link href="/ai-tools" className="inline-flex shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/10 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-white/20">
            العربية
          </Link>
        </div>
      </section>

      <section className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-extrabold text-slate-900">Looking for the original full directory?</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">This is an independent curated selection. Pricing, plans, and features can change by provider.</p>
        </div>
        <a href="https://dealsbe.com/" target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center justify-center rounded-xl bg-indigo-700 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-800">
          Explore DealsBe ↗
        </a>
      </section>

      <div className="mt-6">
        <AIToolsDirectory lang="en" />
      </div>

      <div className="mt-8 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs leading-6 text-amber-950">
        <strong>Note:</strong> These are third-party products, not services operated by Sham AI. Some features may require an account or paid plan. Review the provider's current plan details and privacy policy before using a service.
      </div>

    </main>
  );
}
