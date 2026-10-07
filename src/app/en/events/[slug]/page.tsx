import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import { EN_EVENTS, bySlug } from "@/lib/enDesk";
import { SITE_URL } from "@/lib/siteUrl";

export function generateStaticParams() {
  return EN_EVENTS.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const item = bySlug(EN_EVENTS, slug);
  if (!item) return {};
  const url = `${SITE_URL}/en/events/${item.slug}`;
  return {
    title: { absolute: `${item.title} | Sham AI` },
    description: item.dek,
    alternates: { canonical: url, languages: { en: url } },
  };
}

export default async function Page(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const item = bySlug(EN_EVENTS, slug);
  if (!item) notFound();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <p className="text-xs text-slate-400">{item.date}</p>
      <h1 className="mt-2 text-3xl font-extrabold tracking-tight">{item.title}</h1>
      <p className="mt-3 text-base leading-7 text-slate-600">{item.dek}</p>
      <AdSlot position="in-content" label="English story" />
      {item.body.map((paragraph) => (
        <p key={paragraph} className="mt-4 text-sm leading-7 text-slate-800">{paragraph}</p>
      ))}
      {item.tool && <Link href={item.tool} className="mt-6 inline-block rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white">Open the tool</Link>}
    </main>
  );
}
