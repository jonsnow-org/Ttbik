import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "Public events for English readers",
  description: "English event cards for international public dates and product moments. Regional Arabic events stay on the Arabic desk.",
  alternates: { canonical: `${SITE_URL}/en/events`, languages: { en: `${SITE_URL}/en/events` } },
};

export default function EnglishEvents() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-extrabold">Events</h1>
      <article className="mt-6 rounded-2xl border p-4">
        <h2 className="text-xl font-bold">A public date needs a source</h2>
        <p className="mt-2 text-slate-700">Event cards here name an international date, link the official source, and point to a related tool. They do not copy Arabic channel coverage.</p>
        <Link className="mt-3 inline-block font-bold" href="/free-tools">Related tools</Link>
      </article>
    </main>
  );
}
