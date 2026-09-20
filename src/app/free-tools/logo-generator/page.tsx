import type { Metadata } from "next";
import LogoGenerator from "./LogoGenerator";
import AdSlot from "@/components/AdSlot";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "مولّد شعارات نصية عربية مجاني | سوق تولز",
  description:
    "أنشئ شعاراً نصياً (wordmark) عربياً لمشروعك خلال ثوانٍ — خطوط عربية حقيقية وتنسيقات ألوان جاهزة، تنزيل PNG فوري، بلا تسجيل.",
  alternates: { canonical: `${SITE_URL}/free-tools/logo-generator` },
};

export default function LogoGeneratorPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">مولّد الشعارات النصية العربية</h1>
      <p className="mt-2 text-slate-600">
        اكتب اسم مشروعك، اختر خطاً عربياً وتنسيق ألوان، واحصل فوراً على شعار نصي جاهز للتنزيل — يعمل بالكامل داخل
        متصفحك.
      </p>
      <div className="mt-6">
        <LogoGenerator />
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل مولّد الشعارات" />
      </div>
    </div>
  );
}
