import type { Metadata } from "next";
import Link from "next/link";
import ImageOptimizer from "@/app/free-tools/image-optimizer/ImageOptimizer";
import AdSlot from "@/components/AdSlot";
import { SITE_URL } from "@/lib/siteUrl";
import { EN_FREE_TOOLS } from "@/lib/enFreeTools";

export const metadata: Metadata = {
  // title.absolute opts out of the root layout's Arabic title template
  // ("%s | شام AI") — see qr-generator's English page for the same fix.
  title: { absolute: "Free Image Compressor — WebP/JPEG/PNG | Sham AI" },
  description:
    "Compress and convert your images to WebP, JPEG, or PNG right in your browser — free, no upload to any server, full privacy, instant results.",
  alternates: {
    canonical: `${SITE_URL}/en/free-tools/image-optimizer`,
    languages: {
      ar: `${SITE_URL}/free-tools/image-optimizer`,
      en: `${SITE_URL}/en/free-tools/image-optimizer`,
      "x-default": `${SITE_URL}/free-tools/image-optimizer`,
    },
  },
  openGraph: {
    locale: "en_US",
    url: `${SITE_URL}/en/free-tools/image-optimizer`,
    title: "Free Image Compressor — WebP/JPEG/PNG | Sham AI",
    description: "Compress and convert images to WebP, JPEG, or PNG in your browser — free, no upload to any server.",
  },
  twitter: {
    title: "Free Image Compressor — WebP/JPEG/PNG | Sham AI",
    description: "Compress and convert images to WebP, JPEG, or PNG in your browser — free, no upload to any server.",
  },
};

export default function ImageOptimizerEnPage() {
  return (
    <div dir="ltr" lang="en" className="mx-auto max-w-xl px-4 py-12">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
          🎁 100% Free — Runs In Your Browser
        </span>
        <Link href="/free-tools/image-optimizer" className="shrink-0 text-xs font-semibold text-slate-500 hover:text-brand-700">
          🇸🇦 العربية
        </Link>
      </div>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">Free Image Compressor</h1>
      <p className="mt-2 text-slate-600">
        Upload an image (PNG, JPEG, or WebP), pick the format and quality, and download a
        smaller version instantly — all of this happens entirely in your browser, your image
        is never uploaded to our server or anyone else's.
      </p>
      <div className="mt-6">
        <ImageOptimizer lang="en" />
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="Below image compressor (EN)" />
      </div>
      <p className="mt-8 text-sm text-slate-500">
        More free tools:{" "}
        {EN_FREE_TOOLS.filter((t) => t.href !== "/en/free-tools/image-optimizer").map((t, i) => (
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
