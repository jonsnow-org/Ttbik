import type { Metadata } from "next";
import PercentageCalculator from "./PercentageCalculator";
import AdSlot from "@/components/AdSlot";
import ToolSeoSection from "@/components/ToolSeoSection";

export const metadata: Metadata = {
  title: "حاسبة النسبة المئوية والخصم | شام AI",
  description:
    "حاسبة النسبة المئوية: كم يساوي ٪ من رقم، نسبة الزيادة والنقصان، السعر بعد الخصم — فورية ومجانية بالعربي.",
  keywords: ["حاسبة النسبة المئوية", "حساب النسبة المئوية", "حاسبة الخصم", "حساب نسبة الزيادة", "كم يساوي 15% من"],
  alternates: { canonical: "/free-tools/percentage-calculator" },
};

export default function Page() {
  return (
    <>
      <div className="mx-auto max-w-xl px-4 py-12">
        <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">🎁 أداة مجانية بالكامل</span>
        <h1 className="mt-3 text-2xl font-extrabold text-slate-900">حاسبة النسبة المئوية والخصم</h1>
        <p className="mt-2 text-slate-600">أربع حاسبات في صفحة واحدة: نسبة من عدد، جزء من كل، نسبة التغيير، والسعر بعد الخصم — نتيجة فورية أثناء الكتابة.</p>
        <div className="mt-6">
          <PercentageCalculator />
        </div>
        <div className="mt-8">
          <AdSlot position="in-content" label="أسفل حاسبة النسبة المئوية والخصم" />
        </div>
      </div>
      <ToolSeoSection slug="percentage-calculator" />
    </>
  );
}
