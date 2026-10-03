import type { Metadata } from "next";
import Link from "next/link";
import UrlShortener from "./UrlShortener";
import AdSlot from "@/components/AdSlot";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "اختصار روابط مجاني مع عداد نقرات حقيقي | سوق تولز",
  description:
    "قصّر الروابط الطويلة مجاناً واحصل على عداد نقرات حقيقي — مثالي للسوشيال والإعلانات والمتاجر. بلا تسجيل.",
  keywords: ["اختصار روابط", "مصغر روابط", "عداد نقرات", "رابط قصير مجاني", "سوق تولز"],
  alternates: {
    canonical: `${SITE_URL}/free-tools/url-shortener`,
    languages: {
      ar: `${SITE_URL}/free-tools/url-shortener`,
      en: `${SITE_URL}/en/free-tools/url-shortener`,
      "x-default": `${SITE_URL}/free-tools/url-shortener`,
    },
  },
};

export default function UrlShortenerPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
          🎁 أداة مجانية بالكامل
        </span>
        <Link href="/en/free-tools/url-shortener" className="text-xs font-semibold text-slate-500 hover:text-brand-700">
          🇬🇧 English
        </Link>
      </div>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">اختصار روابط مجاني مع عداد نقرات</h1>
      <p className="mt-2 text-slate-600">
        الصق رابطاً طويلاً واحصل فوراً على رابط قصير يعمل على نطاق الموقع مع عداد نقرات حقيقي.
        لا تسجيل، لا تكلفة مستمرة.
      </p>
      <div className="mt-6">
        <UrlShortener />
      </div>
      <p className="mt-6 text-sm text-slate-600">
        أدوات مكملة:{" "}
        <Link href="/free-tools/whatsapp-link" className="font-bold text-sky-700 hover:underline">
          رابط واتساب
        </Link>
        {" · "}
        <Link href="/free-tools/digital-card" className="font-bold text-sky-700 hover:underline">
          بطاقة أعمال رقمية
        </Link>
        {" · "}
        <Link href="/free-tools/qr-generator" className="font-bold text-sky-700 hover:underline">
          QR
        </Link>
      </p>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل مصغّر الروابط" />
      </div>
    </div>
  );
}
