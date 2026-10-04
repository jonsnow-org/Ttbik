import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import AdSlot from "@/components/AdSlot";
import ResultView from "./ResultView";

export const metadata: Metadata = {
  title: "رابط طلب واتساب جاهز | شام AI",
};

export default function WhatsappLinkResultPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/free-tools/whatsapp-link" className="text-sm font-semibold text-brand-700 hover:underline">
        ← مولد رابط طلب واتساب
      </Link>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">رابطك جاهز ✅</h1>

      <div className="my-6">
        <AdSlot position="in-content" label="أعلى نتيجة رابط واتساب" />
      </div>

      <Suspense fallback={null}>
        <ResultView />
      </Suspense>

      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل نتيجة رابط واتساب" />
      </div>

      <Link
        href="/free-tools/whatsapp-link"
        className="mt-6 inline-block rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-700"
      >
        🔁 إنشاء رابط آخر
      </Link>
    </div>
  );
}
