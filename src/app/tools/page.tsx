import type { Metadata } from "next";
import ToolsStudio from "@/components/ToolsStudio";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "استوديو الأدوات المجانية",
  description: "كل أدوات شام AI في صفحة واحدة: بحث، تصنيف، وآخر ما استخدمته. تعمل في المتصفح بلا تسجيل.",
  alternates: { canonical: `${SITE_URL}/tools`, languages: { ar: `${SITE_URL}/tools`, en: `${SITE_URL}/en/free-tools` } },
};

export default function ToolsPage() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <p className="text-xs font-bold text-emerald-700">شام AI</p>
      <h1 className="mt-1 text-2xl font-extrabold text-slate-900 sm:text-3xl">استوديو الأدوات</h1>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-600">ابحث أو اختر تصنيفاً. الأداة تُفتح في صفحتها، والحساب يبقى في متصفحك.</p>
      <div className="mt-5">
        <ToolsStudio />
      </div>
    </main>
  );
}
