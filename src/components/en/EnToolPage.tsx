import Link from "next/link";
import type { ReactNode } from "react";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import { EN_TOOL_PAGES } from "@/lib/enToolSeo";
import { SITE_URL } from "@/lib/siteUrl";

export function enToolMetadata(slug: string) {
  const t = EN_TOOL_PAGES.find((x) => x.slug === slug)!;
  const url = `${SITE_URL}/en/free-tools/${slug}`;
  return {
    title: { absolute: `${t.title} | Sham AI` },
    description: t.desc,
    alternates: {
      canonical: url,
      languages: t.ar ? { en: url, ar: `${SITE_URL}/free-tools/${t.ar}` } : { en: url },
    },
  };
}

export default function EnToolPage({ slug, children }: { slug: string; children: ReactNode }) {
  const t = EN_TOOL_PAGES.find((x) => x.slug === slug)!;
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: t.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  const appLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: t.h1,
    url: `${SITE_URL}/en/free-tools/${slug}`,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    inLanguage: "en",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  const related = EN_TOOL_PAGES.filter((x) => x.slug !== slug).slice(0, 5);
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en" dir="ltr">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appLd) }} />
      <EnglishDeskNav />
      <h1 className="mb-2 text-2xl font-extrabold">{t.h1}</h1>
      <p className="mb-4 text-sm leading-7 text-slate-600">{t.intro}</p>
      {children}
      <AdSlot position="in-content" label="Below English tool" />
      <section className="mt-8 space-y-3 text-[15px] leading-8 text-slate-700">
        <h2 className="text-xl font-extrabold text-slate-900">About this tool</h2>
        {t.about.map((p) => (
          <p key={p.slice(0, 20)}>{p}</p>
        ))}
        <h2 className="pt-3 text-xl font-extrabold text-slate-900">FAQ</h2>
        {t.faq.map((f) => (
          <div key={f.q} className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="font-bold text-slate-900">{f.q}</h3>
            <p className="mt-1 text-sm leading-7">{f.a}</p>
          </div>
        ))}
      </section>
      <div className="mt-6 flex flex-wrap gap-2">
        {related.map((r) => (
          <Link key={r.slug} href={`/en/free-tools/${r.slug}`} className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-emerald-100">
            {r.h1}
          </Link>
        ))}
        <Link className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-bold text-slate-700" href="/en/free-tools">All English tools</Link>
      </div>
    </main>
  );
}
