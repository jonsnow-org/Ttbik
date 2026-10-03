import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import ResultView from "./ResultView";

export const metadata: Metadata = {
  title: "نتيجة مساعد الكتابة | شام AI",
};

export default function WritingAssistantResultPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/free-tools/writing-assistant" className="text-sm font-semibold text-rose-700 hover:underline">
        ← مساعد الكتابة الذكي
      </Link>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">نتيجتك جاهزة 🎉</h1>

      <div className="my-6">
        <AdSlot position="in-content" label="أعلى نتيجة مساعد الكتابة" />
      </div>

      <Suspense fallback={null}>
        <ResultView />
      </Suspense>

      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل نتيجة مساعد الكتابة" />
      </div>

      <Link
        href="/free-tools/writing-assistant"
        className="mt-6 inline-block rounded-xl bg-rose-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-rose-800"
      >
        🔁 توليد نص آخر
      </Link>
    </div>
  );
}
