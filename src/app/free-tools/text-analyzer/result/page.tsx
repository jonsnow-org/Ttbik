import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import ResultView from "./ResultView";

export const metadata: Metadata = {
  title: "نتيجة محلل النصوص | شام AI",
};

export default function TextAnalyzerResultPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/free-tools/text-analyzer" className="text-sm font-semibold text-sky-700 hover:underline">
        ← محلل النصوص الذكي
      </Link>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">نتيجة التحليل جاهزة 🎉</h1>

      <div className="my-6">
        <AdSlot position="in-content" label="أعلى نتيجة محلل النصوص" />
      </div>

      <Suspense fallback={null}>
        <ResultView />
      </Suspense>

      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل نتيجة محلل النصوص" />
      </div>

      <Link
        href="/free-tools/text-analyzer"
        className="mt-6 inline-block rounded-xl bg-sky-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-sky-800"
      >
        🔁 تحليل نص آخر
      </Link>
    </div>
  );
}
