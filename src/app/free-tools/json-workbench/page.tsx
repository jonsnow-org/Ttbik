import type { Metadata } from "next";
import { toolMeta } from "@/lib/toolMeta";
import JsonWorkbench from "./JsonWorkbench";
import AdSlot from "@/components/AdSlot";
import ToolSeoSection from "@/components/ToolSeoSection";

export const metadata: Metadata = toolMeta("json-workbench", {
  title: "منسّق JSON ومحوّل CSV إلى JSON مجاناً | شام AI",
  description: "تحقق من JSON ونسّقه أو صغّره، وحوّل CSV إلى JSON داخل المتصفح مع نسخ وتنزيل النتيجة بلا تسجيل.",
  keywords: ["منسق JSON", "مصحح JSON", "JSON formatter", "CSV إلى JSON", "JSON validator"],
});

export default function JsonWorkbenchPage() {
  return (
    <>
      <div className="mx-auto max-w-2xl px-4 py-12" dir="rtl" lang="ar">
        <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">🎁 أداة مجانية بالكامل</span>
        <h1 className="mt-3 text-2xl font-extrabold text-slate-900">منسّق JSON ومحوّل CSV إلى JSON</h1>
        <p className="mt-2 text-slate-600">تحقق من صحة JSON، رتّب المسافات والأسطر لقراءته، صغّر حجمه، أو حوّل جدول CSV إلى JSON. انسخ النتيجة أو نزّلها كملف — كل شيء داخل المتصفح.</p>
        <div className="mt-6"><JsonWorkbench /></div>
        <div className="mt-8"><AdSlot position="in-content" label="أسفل منسّق JSON ومحوّل CSV" /></div>
      </div>
      <ToolSeoSection slug="json-workbench" />
    </>
  );
}
