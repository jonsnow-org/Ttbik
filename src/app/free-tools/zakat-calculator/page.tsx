import type { Metadata } from "next";
import ZakatCalculator from "./ZakatCalculator";
import AdSlot from "@/components/AdSlot";

export const metadata: Metadata = {
  title: "حاسبة الزكاة الذكية | أدوات مجانية | سوق تولز",
  description:
    "احسب زكاة المال والذهب والفضة والأسهم وعروض التجارة فوراً — نصاب قابل للتعديل، 2.5%. أداة عربية مجانية بلا تسجيل.",
};

export default function ZakatCalculatorPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">
        حاسبة الزكاة الذكية
      </h1>
      <p className="mt-2 text-slate-600">
        أدخل النقد والذهب (بعياره) والفضة والأسهم وعروض التجارة والديون — تحصل
        فوراً على ما إذا بلغ النصاب ومبلغ الزكاة 2.5%. مناسبة لرمضان ونهاية السنة
        الهجرية والحج.
      </p>
      <div className="mt-6">
        <ZakatCalculator />
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل حاسبة الزكاة" />
      </div>
    </div>
  );
}
