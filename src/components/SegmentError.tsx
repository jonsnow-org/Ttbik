"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Shared Arabic error UI for segment error.tsx files (news/events/articles/bots/free-tools).
 * Keeps the rest of the app chrome intact; only the failing segment is replaced.
 */
export default function SegmentError({
  error,
  reset,
  title,
  homeHref = "/",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  title: string;
  homeHref?: string;
}) {
  useEffect(() => {
    // Keep console noise for owner/debug; never surface stack to visitors.
    console.error("[segment-error]", title, error?.digest || error?.message);
  }, [error, title]);

  return (
    <main className="mx-auto max-w-lg px-4 py-16 text-center" dir="rtl" lang="ar">
      <p className="text-4xl" aria-hidden="true">
        ⚠️
      </p>
      <h1 className="mt-3 text-xl font-extrabold text-slate-900">{title}</h1>
      <p className="mt-2 text-sm leading-7 text-slate-600">
        تعذّر تحميل هذا القسم الآن. جرّب مرة أخرى، أو عد إلى الرئيسة. باقي الموقع يعمل بشكل طبيعي.
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-indigo-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-indigo-700"
        >
          إعادة المحاولة
        </button>
        <Link
          href={homeHref}
          className="rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-bold text-slate-700 hover:bg-slate-50"
        >
          الرئيسة
        </Link>
      </div>
    </main>
  );
}
