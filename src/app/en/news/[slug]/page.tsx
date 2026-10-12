import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import { englishCover } from "@/components/EnglishStoryCard";
import { EN_NEWS, bySlug } from "@/lib/enDesk";
import { SITE_URL } from "@/lib/siteUrl";

export function generateStaticParams() {
  return EN_NEWS.map((item) => ({ slug: item.slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  const item = bySlug(EN_NEWS, slug);
  if (!item) return {};
  const url = `${SITE_URL}/en/news/${item.slug}`;
  return {
    title: { absolute: `${item.title} | Sham AI` },
    description: item.dek,
    alternates: { canonical: url, languages: { en: url } },
    openGraph: { images: [{ url: englishCover(item.slug), width: 1200, height: 630 }] },
  };
}

export default async function Page(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const item = bySlug(EN_NEWS, slug);
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
          <AdSlot position="in-content" label="English story" />
          {item.body.map((paragraph) => (
            <p key={paragraph} className="mt-4 text-sm leading-7 text-slate-800">{paragraph}</p>
          ))}
          {item.tool && <Link href={item.tool} className="mt-6 inline-block rounded-full bg-sky-500 px-4 py-2 text-sm font-bold text-white hover:bg-sky-600">Open the related page</Link>}
        </div>
      </article>
    </main>
  );
}
