import type { Metadata } from "next";
import HijriConverter from "./HijriConverter";
import AdSlot from "@/components/AdSlot";

export const metadata: Metadata = {
  title: "محوّل التاريخ الهجري والميلادي | أدوات مجانية | شام AI",
  description:
    "حوّل أي تاريخ بين الهجري والميلادي فوراً مع أسماء الأشهر العربية واسم اليوم — أداة مجانية بلا تسجيل تعمل داخل المتصفح.",
};

export default function HijriConverterPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">
        محوّل التاريخ الهجري ↔ الميلادي
      </h1>
      <p className="mt-2 text-slate-600">
        أدخل يوماً وشهراً وسنة (ميلادي أو هجري) واحصل فوراً على التاريخ المقابل
        مع اسم الشهر بالعربي واسم اليوم. مفيد لرمضان والأعياد والمواعيد الشرعية.
      </p>
      <div className="mt-6">
        <HijriConverter />
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل محوّل التاريخ الهجري" />
      </div>
    </div>
  );
}
