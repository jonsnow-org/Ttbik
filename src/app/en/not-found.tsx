import type { Metadata } from "next";
import Link from "next/link";

// English 404 for /en/*: the root 404 used the Arabic «… | شام AI» template, so English misses
// showed "Sham AI English … | شام AI" (mixed brands).
export const metadata: Metadata = {
  title: { absolute: "Page not found | Sham AI" },
  robots: { index: false, follow: true },
};

export default function EnNotFound() {
  return (
    <main lang="en" dir="ltr" className="mx-auto max-w-xl px-4 py-20 text-center">
      <p className="text-5xl font-black text-slate-300">404</p>
      <h1 className="mt-4 text-2xl font-black text-slate-900">Page not found</h1>
      <p className="mt-2 text-slate-600">The link may have changed or the page was removed.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/en" className="rounded-xl bg-slate-900 px-5 py-2.5 font-bold text-white">English home</Link>
        <Link href="/" lang="ar" dir="rtl" className="rounded-xl border border-slate-300 px-5 py-2.5 font-bold text-slate-800">العربية</Link>
      </div>
    </main>
  );
}
