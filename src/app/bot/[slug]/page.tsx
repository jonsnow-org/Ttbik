import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BOT_LANDINGS } from "@/lib/botLanding";
import { SITE_URL } from "@/lib/siteUrl";

export function generateStaticParams() {
  return BOT_LANDINGS.map((b) => ({ slug: b.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const b = BOT_LANDINGS.find((x) => x.slug === slug);
  if (!b) return {};
  return {
    title: `${b.name} على تليجرام | شام AI`,
    description: b.summary,
    keywords: b.keywords,
    alternates: { canonical: `/bot/${b.slug}` },
  };
}

export default async function BotLanding({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const b = BOT_LANDINGS.find((x) => x.slug === slug);
  if (!b) notFound();
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: b.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  const appLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: b.name,
    url: `${SITE_URL}/bot/${b.slug}`,
    applicationCategory: "CommunicationApplication",
    operatingSystem: "Telegram",
    inLanguage: "ar",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  const others = BOT_LANDINGS.filter((x) => x.slug !== b.slug);
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appLd) }} />
      <h1 className="text-2xl font-extrabold leading-10 text-slate-900">{b.h1}</h1>
      <p className="mt-3 text-[15px] leading-8 text-slate-700">{b.summary}</p>
      <a href={b.href} target="_blank" rel="noopener noreferrer" className="mt-5 block rounded-2xl bg-sky-600 px-6 py-3.5 text-center text-lg font-extrabold text-white">
        افتح {b.name} في تليجرام ←
      </a>
      <h2 className="mt-8 text-xl font-extrabold text-slate-900">المزايا</h2>
      <ul className="mt-2 list-disc space-y-1 ps-6 text-slate-700">{b.features.map((f) => <li key={f}>{f}</li>)}</ul>
      <h2 className="mt-8 text-xl font-extrabold text-slate-900">طريقة الاستخدام</h2>
      <ol className="mt-2 list-decimal space-y-1 ps-6 text-slate-700">{b.steps.map((f) => <li key={f}>{f}</li>)}</ol>
      <h2 className="mt-8 text-xl font-extrabold text-slate-900">أسئلة شائعة</h2>
      <div className="mt-2 space-y-3">
        {b.faq.map((f) => (
          <div key={f.q} className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="font-bold text-slate-900">{f.q}</h3>
            <p className="mt-1 text-sm leading-7 text-slate-700">{f.a}</p>
          </div>
        ))}
      </div>
      <h2 className="mt-8 text-lg font-extrabold text-slate-900">بوتات أخرى</h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {others.map((o) => (
          <Link key={o.slug} href={`/bot/${o.slug}`} className="rounded-full bg-slate-100 px-3 py-1.5 text-sm font-bold text-slate-700 hover:bg-sky-100">{o.name}</Link>
        ))}
      </div>
    </div>
  );
}
