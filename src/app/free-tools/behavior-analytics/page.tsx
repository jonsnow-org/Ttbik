import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";
import BehaviorAnalytics from "./BehaviorAnalytics";

export const metadata: Metadata = {
  title: "محلل سلوك الأحداث (CSV/JSON) مجاناً | شام AI",
  description:
    "الصق سجلات أحداث CSV أو JSON واحصل على ملخص سلوك المستخدمين فوراً في المتصفح — بلا تسجيل.",
};

export default function BehaviorAnalyticsPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12" dir="rtl" lang="ar">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">محلل سلوك الأحداث</h1>
      <p className="mt-2 text-slate-600">
        الصق JSON أو CSV لأحداث (وقت، حدث، مستخدم) واحصل على ملخص فوري داخل المتصفح — مناسب لتجّار التطبيقات والمتاجر.
      </p>
      <div className="mt-6">
        <BehaviorAnalytics />
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل محلل السلوك" />
      </div>
    </div>
  );
}
