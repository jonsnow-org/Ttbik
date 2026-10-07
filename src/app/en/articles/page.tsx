import type { Metadata } from "next";
import Link from "next/link";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "English how-to articles for free tools",
  description: "Step-by-step English articles for QR codes, short links, and image size checks. Each article ends at a browser tool.",
  alternates: { canonical: `${SITE_URL}/en/articles`, languages: { en: `${SITE_URL}/en/articles`, "x-default": `${SITE_URL}/en/articles` } },
};

export default function EnglishArticles() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-8" lang="en">
      <nav className="mb-5 text-sm text-slate-500" aria-label="Breadcrumb">
        <Link href="/en" className="hover:text-slate-800">Home</Link>
        <span> / Articles</span>
      </nav>
      <h1 className="mb-2 text-2xl font-extrabold text-slate-900">Articles</h1>
      <p className="mb-6 text-sm leading-7 text-slate-600">How-to pages for English searches. They explain a task, then open the tool.</p>
      <article className="rounded-3xl border border-slate-200 p-4">
        <h2 className="text-lg font-bold">Make a QR code without an account</h2>
        <p className="mt-2 text-sm leading-7 text-slate-700">Paste the link, check the preview, and download the image. The text stays in the browser. Use it for a menu, a Wi-Fi card, or a product page.</p>
        <Link className="mt-3 inline-block text-sm font-bold" href="/en/free-tools/qr-generator">Open the QR generator</Link>
      </article>
    </main>
  );
}
