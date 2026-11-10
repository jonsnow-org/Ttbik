import type { Metadata } from "next";
import Link from "next/link";

// One clear 404 for the whole site. Without this file Next's default page added its own
// «404: This page could not be found.» <title> next to the site's, so the 404 had two titles.
export const metadata: Metadata = {
  title: "الصفحة غير موجودة",
  robots: { index: false, follow: true },
};

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-20 text-center">
      <p className="text-5xl font-black text-slate-300">404</p>
      <h1 className="mt-4 text-2xl font-black text-slate-900">الصفحة غير موجودة</h1>
      <p className="mt-2 text-slate-600">ربما تغيّر الرابط أو حُذفت الصفحة.</p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link href="/" className="rounded-xl bg-slate-900 px-5 py-2.5 font-bold text-white">الرئيسية</Link>
        <Link href="/#services" className="rounded-xl border border-slate-300 px-5 py-2.5 font-bold text-slate-800">خدمات وأرباح</Link>
        <Link href="/en" lang="en" dir="ltr" className="rounded-xl border border-slate-300 px-5 py-2.5 font-bold text-slate-800">English</Link>
      </div>
    </main>
  );
}
