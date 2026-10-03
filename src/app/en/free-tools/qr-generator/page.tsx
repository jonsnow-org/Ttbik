import type { Metadata } from "next";
import Link from "next/link";
import QrGenerator from "@/app/free-tools/qr-generator/QrGenerator";
import AdSlot from "@/components/AdSlot";
import { SITE_URL } from "@/lib/siteUrl";
import { EN_FREE_TOOLS } from "@/lib/enFreeTools";

export const metadata: Metadata = {
  // title.absolute (not a plain string) opts out of the root layout's
  // Arabic title template ("%s | شام AI") — an English SEO page must
  // not end in an Arabic brand suffix in search results.
  title: { absolute: "Free QR Code Generator — No Signup | Sham AI" },
  description:
    "Generate a QR code for any link or text in seconds — customizable size and colors, instant PNG download, runs entirely in your browser, free, no signup required.",
  alternates: {
    canonical: `${SITE_URL}/en/free-tools/qr-generator`,
    languages: {
      ar: `${SITE_URL}/free-tools/qr-generator`,
      en: `${SITE_URL}/en/free-tools/qr-generator`,
      "x-default": `${SITE_URL}/free-tools/qr-generator`,
    },
  },
  openGraph: {
    locale: "en_US",
    url: `${SITE_URL}/en/free-tools/qr-generator`,
    title: "Free QR Code Generator — No Signup | Sham AI",
    description: "Generate a QR code for any link or text in seconds — free, no signup, runs in your browser.",
  },
  twitter: {
    title: "Free QR Code Generator — No Signup | Sham AI",
    description: "Generate a QR code for any link or text in seconds — free, no signup, runs in your browser.",
  },
};

export default function QrGeneratorEnPage() {
  return (
    <div dir="ltr" lang="en" className="mx-auto max-w-xl px-4 py-12">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
          🎁 100% Free Tool
        </span>
        <Link href="/free-tools/qr-generator" className="text-xs font-semibold text-slate-500 hover:text-brand-700">
          🇸🇦 العربية
        </Link>
      </div>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">
        Free QR Code Generator
      </h1>
      <p className="mt-2 text-slate-600">
        Paste any link or text and get an instant QR code ready to download or copy —
        customize the size and colors. Runs locally in your browser, no signup needed.
      </p>
      <div className="mt-6">
        <QrGenerator lang="en" />
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="Below QR generator (EN)" />
      </div>
      <p className="mt-8 text-sm text-slate-500">
        More free tools:{" "}
        {EN_FREE_TOOLS.filter((t) => t.href !== "/en/free-tools/qr-generator").map((t, i) => (
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
