import type { Metadata } from "next";
import Link from "next/link";
import QrGenerator from "./QrGenerator";
import AdSlot from "@/components/AdSlot";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "مولّد رمز QR مجاني (عربي) | أدوات مجانية | شام AI",
  description:
    "أنشئ رمز QR لأي رابط أو نص خلال ثوانٍ — حجم وألوان قابلة للتخصيص، تنزيل PNG فوري، يعمل بالكامل داخل المتصفح بلا تسجيل وبلا تكلفة.",
  alternates: {
    canonical: `${SITE_URL}/free-tools/qr-generator`,
    languages: {
      ar: `${SITE_URL}/free-tools/qr-generator`,
      en: `${SITE_URL}/en/free-tools/qr-generator`,
      "x-default": `${SITE_URL}/free-tools/qr-generator`,
    },
  },
};

export default function QrGeneratorPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
          🎁 أداة مجانية بالكامل
        </span>
        <Link href="/en/free-tools/qr-generator" className="text-xs font-semibold text-slate-500 hover:text-brand-700">
          🇬🇧 English
        </Link>
      </div>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">
        مولّد رمز QR
      </h1>
      <p className="mt-2 text-slate-600">
        الصق رابطاً أو أي نص واحصل فوراً على رمز QR جاهز للتنزيل أو النسخ —
        خصّص الحجم والألوان. يعمل محلياً في متصفحك، بلا تسجيل.
      </p>
      <div className="mt-6">
        <QrGenerator />
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل مولّد QR" />
      </div>
    </div>
  );
}
