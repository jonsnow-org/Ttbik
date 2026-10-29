import type { Metadata } from "next";
import Link from "next/link";
import AIToolsDirectory from "@/components/AIToolsDirectory";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "دليل أدوات الذكاء الاصطناعي",
  description: "اكتشف أدوات مختارة للكتابة وتوليد الصور والفيديو والبرمجة والبحث والإنتاجية والتصميم والتسويق. ابحث وصنّف الأدوات بالعربية.",
  alternates: {
    canonical: `${SITE_URL}/ai-tools`,
    languages: { ar: `${SITE_URL}/ai-tools`, en: `${SITE_URL}/en/ai-tools` },
  },
  openGraph: {
    title: "دليل أدوات الذكاء الاصطناعي | شام AI",
    description: "دليل عربي لأدوات الذكاء الاصطناعي، مع بحث وفلاتر حسب الاستخدام وروابط رسمية.",
    url: `${SITE_URL}/ai-tools`,
    locale: "ar_AR",
    type: "website",
  },
};

export default function AIToolsPage() {
  return (
    <main lang="ar" dir="rtl" className="mx-auto max-w-6xl px-4 py-7 sm:py-10">
      <nav aria-label="مسار التنقل" className="mb-5 text-xs font-semibold text-slate-500">
        <Link href="/" className="hover:text-indigo-700">شام AI</Link>
        <span className="mx-2" aria-hidden="true">/</span>
        <span className="text-slate-800">دليل أدوات الذكاء الاصطناعي</span>
      </nav>

      <section className="relative overflow-hidden rounded-3xl border border-indigo-100 bg-gradient-to-br from-indigo-950 via-slate-900 to-sky-950 p-5 text-white shadow-lg sm:p-8">
        <div className="absolute -left-12 -top-16 h-48 w-48 rounded-full bg-sky-400/10 blur-2xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-3xl">
            <span className="inline-flex rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-bold text-sky-100">دليل مستقل · 8 فئات</span>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">دليل أدوات الذكاء الاصطناعي</h1>
            <p className="mt-3 text-sm leading-7 text-slate-200 sm:text-base">
              اكتشف أدوات للكتابة والصور والفيديو والبرمجة والبحث والإنتاجية والتصميم والتسويق. ابحث عن الأداة المناسبة وافتح موقعها الرسمي مباشرة.
            </p>
          </div>
          <Link href="/en/ai-tools" lang="en" className="inline-flex shrink-0 items-center justify-center rounded-full border border-white/40 bg-white/10 px-4 py-2.5 text-sm font-extrabold text-white hover:bg-white/20">
            English
          </Link>
        </div>
      </section>

      <section className="mt-5 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-extrabold text-slate-900">هل تبحث عن الدليل الأصلي الكامل؟</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">هذه قائمة مختارة ومستقلة؛ قد تتغير الأسعار والخطط والميزات لدى كل مزوّد.</p>
        </div>
        <a href="https://dealsbe.com/" target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center justify-center rounded-xl bg-indigo-700 px-4 py-3 text-sm font-bold text-white hover:bg-indigo-800">
          تصفّح DealsBe ↗
        </a>
      </section>

      <div className="mt-6">
        <AIToolsDirectory lang="ar" />
      </div>

      <div className="mt-8 rounded-2xl border border-amber-100 bg-amber-50 p-4 text-xs leading-6 text-amber-950">
        <strong>ملاحظة:</strong> هذه أدوات من جهات خارجية وليست خدمات يملكها شام AI. بعض الميزات تحتاج إلى حساب أو اشتراك، لذا تحقّق من تفاصيل الخطة وسياسة الخصوصية في الموقع الرسمي قبل الاستخدام.
      </div>

    </main>
  );
}
