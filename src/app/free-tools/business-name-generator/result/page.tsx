import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import ResultView from "./ResultView";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  // Result pages only echo the ?output=… of one visitor: keep them out of the index,
  // point the canonical at the tool, and use an absolute title (the root template already adds "| شام AI").
  title: { absolute: "أسماء مشروعك جاهزة | شام AI" },
  robots: { index: false, follow: true },
  alternates: { canonical: `${SITE_URL}/free-tools/business-name-generator` },
};

export default function BusinessNameResultPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/free-tools/business-name-generator" className="text-sm font-semibold text-brand-700 hover:underline">
        ← مولد أسماء المشاريع
      </Link>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">أسماء مشروعك جاهزة 🎉</h1>

      <div className="my-6">
        <AdSlot position="in-content" label="أعلى نتيجة مولد الأسماء" />
      </div>

      <Suspense fallback={null}>
        <ResultView />
      </Suspense>

      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل نتيجة مولد الأسماء" />
      </div>

      <Link
        href="/free-tools/business-name-generator"
        className="mt-6 inline-block rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700"
      >
        🔁 توليد أسماء أخرى
      </Link>
    </div>
  );
}
