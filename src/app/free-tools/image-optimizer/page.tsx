import type { Metadata } from "next";
import Link from "next/link";
import ImageOptimizer from "./ImageOptimizer";
import AdSlot from "@/components/AdSlot";
import { SITE_URL } from "@/lib/siteUrl";

const PATH = "/free-tools/image-optimizer";

export const metadata: Metadata = {
  title: "أداة ضغط وتحويل الصور مجاناً (WebP/JPEG/PNG) | شام AI",
  description:
    "اضغط صورك وحوّلها إلى WebP أو JPEG أو PNG داخل المتصفح مجاناً — بدون رفع للخادم، تنزيل فوري، خصوصية كاملة.",
  keywords: [
    "ضغط الصور",
    "تحويل WebP",
    "تصغير حجم الصورة",
    "JPEG إلى WebP",
    "أداة ضغط صور مجانية",
    "شام AI",
  ],
  alternates: {
    canonical: `${SITE_URL}${PATH}`,
    languages: {
      ar: `${SITE_URL}${PATH}`,
      en: `${SITE_URL}/en${PATH}`,
      "x-default": `${SITE_URL}${PATH}`,
    },
  },
  openGraph: {
    title: "ضغط وتحويل الصور مجاناً | شام AI",
    description: "WebP / JPEG / PNG داخل المتصفح بلا رفع لخادم.",
    url: `${SITE_URL}${PATH}`,
    locale: "ar_AR",
    type: "website",
    images: [{ url: `${SITE_URL}/og/cover.jpg`, width: 1200, height: 630 }],
  },
};

export default function ImageOptimizerPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
          🎁 أداة مجانية بالكامل — تعمل في متصفحك
        </span>
        <Link
          href="/en/free-tools/image-optimizer"
          className="shrink-0 text-xs font-semibold text-slate-500 hover:text-brand-700"
        >
          🇬🇧 English
        </Link>
      </div>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">ضغط وتحويل الصور</h1>
      <p className="mt-2 text-slate-600">
        ارفع صورة، اختر WebP أو JPEG أو PNG والجودة، ثم احفظ النتيجة. المعالجة محلية في
        المتصفح — لا تُرفع صورتك لأي خادم.
      </p>

      <div className="my-5">
        <AdSlot position="in-content" label="فوق أداة ضغط الصور" />
      </div>

      <div className="mt-2">
        <ImageOptimizer />
      </div>

      <div className="mt-8">
        <AdSlot position="footer-banner" label="أسفل أداة ضغط الصور" />
      </div>

      <section className="mt-10 rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm leading-7 text-slate-600">
        <h2 className="mb-2 text-base font-extrabold text-slate-900">كيف تستخدم الأداة؟</h2>
        <ol className="list-decimal space-y-1 pr-5">
          <li>اختر صورة من جهازك (JPG أو PNG أو WebP).</li>
          <li>حدد الصيغة والجودة، ويمكنك تحديد أقصى عرض بالبكسل.</li>
          <li>اضغط «تحويل وضغط الآن» ثم «حفظ / تنزيل» أو المشاركة على الهاتف.</li>
        </ol>
        <p className="mt-3 text-xs text-slate-500">
          لا نخزّن صورك. النتيجة تُنشأ مؤقتاً في متصفحك فقط.
        </p>
      </section>
    </div>
  );
}
