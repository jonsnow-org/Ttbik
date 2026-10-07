import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "Practical tech news",
  description: "Short English news notes about tools and the open web. Written for international readers, not translated from Arabic desks.",
  alternates: { canonical: `${SITE_URL}/en/news`, languages: { en: `${SITE_URL}/en/news` } },
};

const ITEMS = [
  { href: "/free-tools", title: "Browser tools that need no account", text: "People search for converters and calculators they can use once and close. The free tools desk answers that search." },
];

export default function EnglishNews() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-extrabold">News</h1>
      <p className="mt-2 text-slate-600">Global practical notes. Local Arabic headlines stay on the Arabic desk.</p>
      {ITEMS.map((item) => (
        <article key={item.href} className="mt-6 rounded-2xl border p-4">
          <h2 className="text-xl font-bold">{item.title}</h2>
          <p className="mt-2 text-slate-700">{item.text}</p>
          <Link className="mt-3 inline-block font-bold" href={item.href}>Open the tool</Link>
        </article>
      ))}
    </main>
  );
}
