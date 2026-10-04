import type { Metadata } from "next";
import CvGenerator from "./CvGenerator";
import AdSlot from "@/components/AdSlot";

export const metadata: Metadata = {
  title: "مولّد سيرة ذاتية عربي + PDF | أدوات مجانية | شام AI",
  description:
    "أنشئ سيرة ذاتية عربية احترافية مجاناً واحفظها كـ PDF — بدون تسجيل، بدون مكتبات خارجية، النص العربي يظهر بشكل صحيح.",
};

export default function CvGeneratorPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">مولّد السيرة الذاتية العربي</h1>
      <p className="mt-2 text-slate-600">
        املأ بياناتك، شاهد المعاينة فوراً، ثم اطبع أو احفظ كـ PDF من متصفحك. النص العربي يُعرض صحيحاً
        (اتجاه يمين-يسار وحروف متصلة) بفضل محرك الطباعة في المتصفح — بلا مكتبات خارجية وبلا تكلفة.
      </p>
      <div className="mt-8">
        <CvGenerator />
      </div>
      <div className="mt-8 print:hidden">
        <AdSlot position="in-content" label="أسفل مولّد السيرة الذاتية" />
      </div>
    </div>
  );
}
