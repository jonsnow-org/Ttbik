import type { Metadata } from "next";
import VatCalculator from "./VatCalculator";
import AdSlot from "@/components/AdSlot";

export const metadata: Metadata = {
  title: "حاسبة ضريبة القيمة المضافة VAT | أدوات مجانية | شام AI",
  description:
    "احسب ضريبة القيمة المضافة فوراً للدول العربية: السعودية 15%، الإمارات 5%، مصر 14%، الأردن 16% — مبلغ قبل أو شامل الضريبة. أداة عربية مجانية بلا تسجيل.",
};

export default function VatCalculatorPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">
        حاسبة ضريبة القيمة المضافة (VAT)
      </h1>
      <p className="mt-2 text-slate-600">
        أدخل المبلغ (قبل أو شامل الضريبة) واختر نسبة الدولة — تحصل فوراً على مبلغ
        الضريبة والإجمالي. مناسبة للمتاجر والمستقلين في السعودية والإمارات ومصر
        والأردن وغيرها.
      </p>
      <div className="mt-6">
        <VatCalculator />
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل حاسبة ضريبة القيمة المضافة" />
      </div>
    </div>
  );
}
