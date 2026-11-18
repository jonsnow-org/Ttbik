import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import { englishCover } from "@/components/EnglishStoryCard";
import { EN_EVENTS, bySlug } from "@/lib/enDesk";
import { getEvent } from "@/lib/eventsIndex";
import { getExtraEvent } from "@/lib/eventsExtra";
import { SITE_URL } from "@/lib/siteUrl";

export function generateStaticParams() {
  return EN_EVENTS.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const item = bySlug(EN_EVENTS, slug);
  if (!item) return {};
  const url = `${SITE_URL}/en/events/${item.slug}`;
  const arabic = getEvent(item.slug) || getExtraEvent(item.slug);
  return { title: { absolute: `${item.title} | Sham AI` }, description: item.dek, alternates: { canonical: url, ...(arabic ? { languages: { en: url, ar: `${SITE_URL}/events/${arabic.slug}` } } : {}) } };
}

export default async function Page(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const item = bySlug(EN_EVENTS, slug);
  if (!item) notFound();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <article className="overflow-hidden rounded-3xl border border-sky-100 bg-white shadow-sm">
        <img src={englishCover(item.slug)} alt="" className="aspect-[21/9] w-full object-cover" />
        <div className="p-5 sm:p-7">
          <p className="text-xs font-bold text-sky-700">{item.dateLabel ?? (item.endDate && item.endDate !== item.date ? `${item.date} – ${item.endDate}` : item.date)}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{item.title}</h1>
          <p className="mt-3 text-base leading-7 text-slate-600">{item.dek}</p>
          <AdSlot position="in-content" label="English date" />
          {item.body.map((paragraph) => <p key={paragraph} className="mt-4 text-sm leading-7 text-slate-800">{paragraph}</p>)}
          {item.sources?.length ? (
            <section className="mt-6 border-t border-slate-100 pt-4">
              <h2 className="text-sm font-bold text-slate-900">Sources</h2>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-sky-800">
                {item.sources.map((source) => <li key={source.href}><a href={source.href} target="_blank" rel="noopener noreferrer" className="hover:underline">{source.label}</a></li>)}
              </ul>
            </section>
          ) : null}
          <Link href="/en/events" className="mt-6 inline-block text-sm font-bold text-sky-800">All dates</Link>
        </div>
      </article>
    </main>
  );
}
