import type { Metadata } from "next";
import Link from "next/link";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import AIToolsDirectory from "@/components/AIToolsDirectory";
import { AI_TOOL_CATEGORIES, AI_TOOLS } from "@/lib/aiToolsDirectory";
import { SITE_URL } from "@/lib/siteUrl";

const pageTitle = "AI Tools Directory for Writing, Images, Video & Coding | Sham AI";
const pageDescription =
  "Explore 70+ AI tools for writing, image and video creation, coding, research, design, productivity and SEO. Search by use case and open official tool websites.";

export const metadata: Metadata = {
  title: { absolute: pageTitle },
  description: pageDescription,
  keywords: [
    "AI tools directory",
    "best AI tools",
    "AI writing tools",
    "AI image generators",
    "AI video tools",
    "AI coding assistants",
    "AI research tools",
    "SEO tools",
    "free AI tools",
  ],
  alternates: {
    canonical: SITE_URL + "/en/ai-tools",
    languages: { ar: SITE_URL + "/ai-tools", en: SITE_URL + "/en/ai-tools" },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  openGraph: {
    title: pageTitle,
    description: pageDescription,
    url: SITE_URL + "/en/ai-tools",
    locale: "en_US",
    type: "website",
    siteName: "Sham AI",
  },
  twitter: {
    card: "summary_large_image",
    title: pageTitle,
    description: pageDescription,
  },
};

const DIRECTORY_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "CollectionPage",
  name: pageTitle,
  description: pageDescription,
  url: SITE_URL + "/en/ai-tools",
  inLanguage: "en",
  isPartOf: { "@type": "WebSite", name: "Sham AI", url: SITE_URL },
  mainEntity: {
    "@type": "ItemList",
    itemListOrder: "https://schema.org/ItemListUnordered",
    numberOfItems: AI_TOOLS.length,
    itemListElement: AI_TOOLS.map((tool, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: tool.name,
      url: tool.url,
    })),
  },
};

const BREADCRUMB_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL + "/en" },
    { "@type": "ListItem", position: 2, name: "AI tools directory", item: SITE_URL + "/en/ai-tools" },
  ],
};

export default function AIToolsPageEnglish() {
  return (
    <main lang="en" dir="ltr" className="mx-auto max-w-6xl px-4 py-7 sm:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(DIRECTORY_SCHEMA) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(BREADCRUMB_SCHEMA) }} />
      <EnglishDeskNav />
      <nav aria-label="Breadcrumb" className="mb-5 text-xs font-semibold text-slate-500">
        <Link href="/en" className="hover:text-indigo-700">Sham AI</Link>
        <span className="mx-2" aria-hidden="true">/</span>
        <span className="text-slate-800">AI tools directory</span>
      </nav>

      <section
        className="relative isolate overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-950 via-slate-900 to-sky-950 p-5 text-white shadow-lg sm:p-8"
        style={{
          backgroundImage: "linear-gradient(115deg, rgba(15,23,42,.96), rgba(30,27,75,.87), rgba(8,47,73,.82)), url('https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=1600&q=82')",
          backgroundPosition: "center",
          backgroundSize: "cover",
        }}
      >
        <div className="absolute -right-12 -top-16 -z-10 h-48 w-48 rounded-full bg-sky-400/20 blur-2xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold text-sky-100">
              {AI_TOOLS.length} curated tools · {AI_TOOL_CATEGORIES.length} categories
            </span>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
              AI Tools Directory: Writing, Images, Video & Coding
            </h1>
            <p className="mt-3 text-sm leading-7 text-slate-200 sm:text-base">
              Find practical AI tools for writing and translation, image and video creation, software development, research, productivity, interface design, marketing, and SEO. Search by name or purpose, then visit each provider's official website.
            </p>
          </div>
          <Link href="/ai-tools" hrefLang="ar" className="inline-flex shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/10 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-white/20">
            العربية
          </Link>
        </div>
      </section>

      <section className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-gradient-to-r from-sky-50 via-white to-violet-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-extrabold text-slate-900">Looking for the original full directory?</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            This is an independently written, curated selection. Pricing, free plans, and features can change by provider.
          </p>
        </div>
        <a href="https://dealsbe.com/" target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center justify-center rounded-xl bg-indigo-700 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-800">
          Explore DealsBe ↗
        </a>
      </section>

      <div className="mt-6">
        <AIToolsDirectory lang="en" />
      </div>

      <section aria-labelledby="choose-ai-tools" className="mt-10 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
        <h2 id="choose-ai-tools" className="text-xl font-black text-slate-950">How to choose the right AI tool</h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">
          Start with the task you need to finish rather than the number of features a product advertises. Test output quality, Arabic and other language support, usage limits, privacy terms, commercial-use rights, and the cost of the plan you would actually use.
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <article className="rounded-2xl bg-violet-50 p-4">
            <h3 className="font-extrabold text-violet-950">Writing and research</h3>
            <p className="mt-2 text-sm leading-6 text-violet-900/80">Use assistants for drafts and summaries, and source-focused research tools when you need evidence and citations.</p>
          </article>
          <article className="rounded-2xl bg-fuchsia-50 p-4">
            <h3 className="font-extrabold text-fuchsia-950">Images and video</h3>
            <p className="mt-2 text-sm leading-6 text-fuchsia-900/80">Compare visual quality, editing control, export resolution, generation limits, and permission to use the output commercially.</p>
          </article>
          <article className="rounded-2xl bg-sky-50 p-4">
            <h3 className="font-extrabold text-sky-950">Coding, growth and SEO</h3>
            <p className="mt-2 text-sm leading-6 text-sky-900/80">Evaluate how well a tool fits your current workflow, integrations, technical skill level, reporting needs, and budget.</p>
          </article>
        </div>
        <p className="mt-5 text-sm leading-6 text-slate-600">
          Need browser-based calculators and utilities as well? Visit our <Link href="/en/free-tools" className="font-bold text-indigo-700 underline decoration-indigo-300 underline-offset-4 hover:text-indigo-900">free online tools</Link> directory.
        </p>
      </section>

      <section aria-labelledby="ai-tools-faq" className="mt-8 rounded-3xl border border-slate-200 bg-slate-50 p-5 sm:p-7">
        <h2 id="ai-tools-faq" className="text-xl font-black text-slate-950">AI tools directory: frequently asked questions</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <article className="rounded-2xl bg-white p-4">
            <h3 className="font-bold text-slate-900">Are all AI tools free?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">No. Some products have free plans or trials, while advanced features may require payment. Check the current provider pricing before relying on a feature.</p>
          </article>
          <article className="rounded-2xl bg-white p-4">
            <h3 className="font-bold text-slate-900">Which AI tools support Arabic?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">Support differs by product and task. Try a representative Arabic prompt and review the output carefully before using it in published or professional work.</p>
          </article>
          <article className="rounded-2xl bg-white p-4">
            <h3 className="font-bold text-slate-900">Can I upload private documents?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">Review each provider's privacy policy, retention controls, and account settings first. Avoid sharing passwords, confidential business data, or sensitive personal information unless you have verified the safeguards.</p>
          </article>
          <article className="rounded-2xl bg-white p-4">
            <h3 className="font-bold text-slate-900">How do I find an AI tool for a specific task?</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">Search by tool name or purpose above, then filter by category to narrow the directory to writing, visuals, coding, research, productivity, design, or marketing.</p>
          </article>
        </div>
      </section>

      <div className="mt-8 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs leading-6 text-amber-950">
        <strong>Note:</strong> These are third-party products, not services operated by Sham AI. Some features require an account or paid plan. Check provider terms and privacy policies before use.
      </div>
    </main>
  );
}
