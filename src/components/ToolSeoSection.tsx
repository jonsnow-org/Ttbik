import Link from "next/link";
import { TOOL_SEO } from "@/lib/toolSeo";
import { FREE_TOOLS } from "@/lib/freeTools";
import { EMBED_TOOLS } from "@/lib/embedTools";
import { SITE_URL } from "@/lib/siteUrl";
import EmbedCode from "@/components/EmbedCode";

/**
 * Explanatory text, steps, FAQ (+ FAQPage / HowTo JSON-LD), related tools and,
 * where available, the embed code -- rendered under each free tool so every
 * tool URL is a full, indexable page rather than a bare widget.
 */
export default function ToolSeoSection({ slug }: { slug: string }) {
  const t = TOOL_SEO[slug];
  if (!t) return null;
  const url = `${SITE_URL}/free-tools/${slug}`;
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: t.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  const howLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: `كيف تستخدم ${t.name}`,
    step: t.steps.map((s, i) => ({ "@type": "HowToStep", position: i + 1, text: s })),
  };
  const appLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: t.name,
    url,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any",
    inLanguage: "ar",
    isAccessibleForFree: true,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  const related = FREE_TOOLS.filter((x) => x.href.startsWith("/free-tools/") && x.href !== `/free-tools/${slug}`)
    .sort((a, b) => (a.href.length + slug.length) % 7 - (b.href.length + slug.length) % 7)
    .slice(0, 4);
  const embed = EMBED_TOOLS[slug];

  return (
    <section className="mx-auto mt-10 max-w-xl space-y-8 px-4 pb-10 text-slate-700" aria-label={`شرح ${t.name}`}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(howLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appLd) }} />

      <div>
        <h2 className="text-xl font-extrabold text-slate-900">عن {t.name}</h2>
        <div className="mt-3 space-y-3 text-[15px] leading-8">
          {t.about.map((p) => (
            <p key={p.slice(0, 24)}>{p}</p>
          ))}
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">كيف تستخدمها</h2>
          <ol className="mt-3 list-decimal space-y-2 pr-5 text-[15px] leading-7">
            {t.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </div>
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">لماذا تستخدمها</h2>
          <ul className="mt-3 list-disc space-y-2 pr-5 text-[15px] leading-7">
            {t.benefits.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <h2 className="text-xl font-extrabold text-slate-900">أسئلة شائعة</h2>
        <div className="mt-3 divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
          {t.faq.map((f) => (
            <details key={f.q} className="group p-4">
              <summary className="cursor-pointer list-none font-bold text-slate-900">{f.q}</summary>
              <p className="mt-2 text-[15px] leading-7">{f.a}</p>
            </details>
          ))}
        </div>
      </div>

      {embed && <EmbedCode slug={slug} title={embed.title} height={embed.height} origin={SITE_URL} />}

      <div>
        <h2 className="text-lg font-extrabold text-slate-900">أدوات مجانية أخرى</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {related.map((r) => (
            <li key={r.href}>
              <Link href={r.href} className="block rounded-xl border border-slate-200 bg-white p-3 text-sm font-bold text-indigo-700 hover:bg-indigo-50">
                {r.title}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
