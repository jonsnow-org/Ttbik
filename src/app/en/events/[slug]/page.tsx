import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import { englishCover } from "@/components/EnglishStoryCard";
import { EN_EVENTS, bySlug } from "@/lib/enDesk";
import { SITE_URL } from "@/lib/siteUrl";

export function generateStaticParams() {
  return EN_EVENTS.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const item = bySlug(EN_EVENTS, slug);
  if (!item) return {};
  return { title: { absolute: `${item.title} | Sham AI` }, description: item.dek, alternates: { canonical: `${SITE_URL}/en/events/${item.slug}` } };
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
          <p className="text-xs font-bold text-sky-700">{item.date}</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{item.title}</h1>
          <p className="mt-3 text-base leading-7 text-slate-600">{item.dek}</p>
          <AdSlot position="in-content" label="English date" />
          {item.body.map((paragraph) => <p key={paragraph} className="mt-4 text-sm leading-7 text-slate-800">{paragraph}</p>)}
          <Link href="/en/events" className="mt-6 inline-block text-sm font-bold text-sky-800">All dates</Link>
        </div>
      </article>
    </main>
  );
}
