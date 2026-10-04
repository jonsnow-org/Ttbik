import type { Metadata } from "next";
import Link from "next/link";
import UrlShortener from "@/app/free-tools/url-shortener/UrlShortener";
import AdSlot from "@/components/AdSlot";
import { SITE_URL } from "@/lib/siteUrl";
import { EN_FREE_TOOLS } from "@/lib/enFreeTools";

export const metadata: Metadata = {
  // title.absolute opts out of the root layout's Arabic title template
  // ("%s | شام AI") — see qr-generator's English page for the same fix.
  title: { absolute: "Free URL Shortener + Real Click Counter | Sham AI" },
  description:
    "Shorten any link and get a short URL with a real click counter — free, no signup, no daily limits.",
  alternates: {
    canonical: `${SITE_URL}/en/free-tools/url-shortener`,
    languages: {
      ar: `${SITE_URL}/free-tools/url-shortener`,
      en: `${SITE_URL}/en/free-tools/url-shortener`,
      "x-default": `${SITE_URL}/free-tools/url-shortener`,
    },
  },
  openGraph: {
    locale: "en_US",
    url: `${SITE_URL}/en/free-tools/url-shortener`,
    title: "Free URL Shortener + Real Click Counter | Sham AI",
    description: "Shorten any link and get a short URL with a real click counter — free, no signup.",
  },
  twitter: {
    title: "Free URL Shortener + Real Click Counter | Sham AI",
    description: "Shorten any link and get a short URL with a real click counter — free, no signup.",
  },
};

export default function UrlShortenerEnPage() {
  return (
    <div dir="ltr" lang="en" className="mx-auto max-w-xl px-4 py-12">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
          🎁 100% Free Tool
        </span>
        <Link href="/free-tools/url-shortener" className="text-xs font-semibold text-slate-500 hover:text-brand-700">
          🇸🇦 العربية
        </Link>
      </div>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">Free URL Shortener</h1>
      <p className="mt-2 text-slate-600">
        Paste a long link and instantly get a short one, hosted on this domain, with a real
        click counter. No signup, no recurring cost.
      </p>
      <div className="mt-6">
        <UrlShortener lang="en" />
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="Below URL shortener (EN)" />
      </div>
      <p className="mt-8 text-sm text-slate-500">
        More free tools:{" "}
        {EN_FREE_TOOLS.filter((t) => t.href !== "/en/free-tools/url-shortener").map((t, i) => (
          <span key={t.href}>
            {i > 0 && " · "}
            <Link href={t.href} className="font-semibold text-brand-700 underline">
              {t.title}
            </Link>
          </span>
        ))}
      </p>
    </div>
  );
}
