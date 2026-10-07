import type { Metadata } from "next";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import EnglishDeskNav from "@/components/EnglishDeskNav";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "International dates and tool events",
  description: "English event cards for public international dates, with an official source and a related browser tool.",
  alternates: { canonical: `${SITE_URL}/en/events`, languages: { en: `${SITE_URL}/en/events`, "x-default": `${SITE_URL}/en/events` } },
};

export default function EnglishEvents() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8" lang="en">
      <EnglishDeskNav />
      <h1 className="mb-2 text-4xl font-extrabold tracking-tight text-slate-900">Events</h1>
      <p className="mb-6 text-sm leading-7 text-slate-600">Public dates an English reader can verify. Each card names the date, the source, and a related tool.</p>
      <AdSlot position="in-content" label="English section" />
      <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-bold">World Space Week, 4–10 October</h2>
        <p className="mt-2 text-sm leading-7 text-slate-700">The United Nations marks World Space Week each October. A short link or poster is easier to share as a QR code.</p>
        <a className="mt-3 block text-sm font-bold" href="https://www.worldspaceweek.org/">Official source</a>
        <Link className="mt-2 inline-block text-sm font-bold" href="/en/free-tools/qr-generator">Make a share code</Link>
      </article>
          <AdSlot position="footer-banner" label="English section footer" />
    </main>
  );
}
