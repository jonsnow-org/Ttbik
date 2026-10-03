import type { Metadata } from "next";
import LifeCounter from "./LifeCounter";
import AdSlot from "@/components/AdSlot";

export const metadata: Metadata = {
  title: "عدّاد عمرك الحيّ: كم يوماً وثانية عشت؟ | أدوات مجانية | شام AI",
  description:
    "أدخل تاريخ ميلادك وشاهد عمرك يعدّ بالثواني لحظة بلحظة: الأيام والساعات، نبضات القلب، أيام النوم، اليوم الذي وُلدت فيه، برجك، وكم تبقى لعيد ميلادك القادم. بطاقة جاهزة للمشاركة.",
  keywords: [
    "حساب العمر",
    "عمري بالأيام",
    "كم عمري بالثواني",
    "عداد العمر",
    "حاسبة العمر بالهجري والميلادي",
    "موعد عيد ميلادي",
    "أدوات مجانية",
  ],
};

export default function LifeCounterPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">⏱️ عدّاد عمرك الحيّ</h1>
      <p className="mt-2 text-slate-600">
        اكتب تاريخ ميلادك وشاهد عمرك يزيد ثانية بثانية أمام عينيك — مع أرقام مذهلة عن حياتك وبطاقة تشاركها مع أصدقائك. كل شيء يُحسب داخل متصفحك ولا يُرسل لأي خادم.
      </p>
      <div className="mt-6">
        <LifeCounter />
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل عدّاد العمر" />
      </div>
    </div>
  );
}
