import type { Metadata } from "next";
import ProfitMarginCalculator from "./ProfitMarginCalculator";
import AdSlot from "@/components/AdSlot";

export const metadata: Metadata = {
  title: "حاسبة هامش الربح ونقطة التعادل | أدوات مجانية | شام AI",
  description:
    "احسب هامش الربح ونسبة الإضافة ونقطة التعادل فوراً — تكلفة الوحدة، سعر البيع، التكاليف الثابتة. أداة عربية مجانية بلا تسجيل.",
};

export default function ProfitMarginPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">
        حاسبة هامش الربح ونقطة التعادل
      </h1>
      <p className="mt-2 text-slate-600">
        أدخل تكلفة الوحدة وسعر البيع (والتكاليف الثابتة إن وُجدت) لتحصل فوراً على
        هامش الربح، نسبة الإضافة، ونقطة التعادل بالوحدات. مناسبة لأصحاب المتاجر
        والمستقلين.
      </p>
      <div className="mt-6">
        <ProfitMarginCalculator />
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل حاسبة هامش الربح" />
      </div>
    </div>
  );
}
