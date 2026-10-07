import type { Metadata } from "next";
import BmiCalculator from "./BmiCalculator";
import ToolSponsor from "@/components/ToolSponsor";
import AdSlot from "@/components/AdSlot";

export const metadata: Metadata = {
  title: "حاسبة مؤشر كتلة الجسم BMI والوزن المثالي | أدوات مجانية | شام AI",
  description:
    "احسب مؤشر كتلة الجسم (BMI) والوزن المثالي التقريبي فوراً — نحافة، طبيعي، زيادة وزن أو سمنة. أداة عربية مجانية بلا تسجيل مع نصائح عملية.",
  keywords: [
    "حاسبة BMI",
    "مؤشر كتلة الجسم",
    "الوزن المثالي",
    "حاسبة الوزن",
    "BMI بالعربي",
    "أدوات مجانية",
  ],
};

export default function BmiCalculatorPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">
        حاسبة مؤشر كتلة الجسم (BMI) والوزن المثالي
      </h1>
      <p className="mt-2 text-slate-600">
        أدخل طولك ووزنك واختر الجنس — تحصل فوراً على مؤشر كتلة الجسم، التصنيف
        (نحافة / طبيعي / زيادة / سمنة)، والوزن المثالي التقريبي. مناسبة للبالغين،
        بلا تسجيل وبلا حدود.
      </p>
      <ToolSponsor tool="bmi-calculator" />
      <div className="mt-6">
        <BmiCalculator />
      </div>
      <a href="/sponsor?tool=bmi-calculator" className="mt-3 block text-center text-xs font-bold text-slate-500">رعاية هذه الأداة</a>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل حاسبة BMI" />
      </div>
    </div>
  );
}
