import type { Metadata } from "next";
import BusinessNameGenerator from "./BusinessNameGenerator";
import AdSlot from "@/components/AdSlot";

export const metadata: Metadata = {
  title: "مولد أسماء المشاريع والمتاجر مجاناً | شام AI",
  description: "احصل على 8 اقتراحات أسماء لمشروعك أو متجرك خلال ثوانٍ، مجاناً بالكامل وبدون تسجيل.",
};

export default function BusinessNameGeneratorPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">مولد أسماء المشاريع والمتاجر</h1>
      <p className="mt-2 text-slate-600">
        صف مشروعك بجملة واحدة، واحصل فوراً على 8 اقتراحات أسماء جذابة بالعربية تصلح كاسم تجاري أو حساب سوشيال
        ميديا.
      </p>
      <div className="mt-6">
        <BusinessNameGenerator />
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل مولد الأسماء" />
      </div>
    </div>
  );
}
