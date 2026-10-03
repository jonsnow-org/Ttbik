import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import ResultView from "./ResultView";

export const metadata: Metadata = {
  title: "أسماء مشروعك جاهزة | شام AI",
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
