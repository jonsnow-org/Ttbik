import type { Metadata } from "next";
import PregnancyCalculator from "./PregnancyCalculator";
import AdSlot from "@/components/AdSlot";
import ToolSeoSection from "@/components/ToolSeoSection";

export const metadata: Metadata = {
  title: "حاسبة الحمل وموعد الولادة المتوقع | شام AI",
  description:
    "حاسبة الحمل: اعرفي موعد الولادة المتوقع وعمر الحمل بالأسابيع وبداية كل ثلث من تاريخ آخر دورة — مجانية وبلا تسجيل.",
  keywords: ["حاسبة الحمل", "حاسبة الولادة", "موعد الولادة المتوقع", "حساب عمر الحمل بالأسابيع", "حساب موعد الولادة"],
  alternates: { canonical: "/free-tools/pregnancy-calculator" },
};

export default function Page() {
  return (
    <>
      <div className="mx-auto max-w-xl px-4 py-12">
        <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">🎁 أداة مجانية بالكامل</span>
        <h1 className="mt-3 text-2xl font-extrabold text-slate-900">حاسبة الحمل وموعد الولادة المتوقع</h1>
        <p className="mt-2 text-slate-600">أدخلي تاريخ أول يوم من آخر دورة شهرية فيظهر موعد الولادة المتوقع وعمر الحمل بالأسابيع وتاريخ الحمل التقريبي وبداية كل ثلث.</p>
        <div className="mt-6">
          <PregnancyCalculator />
        </div>
        <div className="mt-8">
          <AdSlot position="in-content" label="أسفل حاسبة الحمل وموعد الولادة" />
        </div>
      </div>
      <ToolSeoSection slug="pregnancy-calculator" />
    </>
  );
}
