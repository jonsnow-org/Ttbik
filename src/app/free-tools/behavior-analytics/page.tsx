import type { Metadata } from "next";
import BehaviorAnalytics from "./BehaviorAnalytics";
import AdSlot from "@/components/AdSlot";

export const metadata: Metadata = {
  title: "محلل البيانات السلوكية مجاناً | سوق تولز",
  description:
    "حلّل سجلات سلوك المستخدمين (CSV أو JSON): أكثر الأحداث، مسار التحويل، النشاط عبر الوقت، والمستخدمون الأكثر تفاعلاً. أداة عربية مجانية تعمل في المتصفح.",
  keywords: [
    "تحليل سلوكي",
    "تحليل بيانات المستخدمين",
    "Behavioral Analytics",
    "تحليل CSV",
    "قمع التحويل",
    "أدوات مجانية",
  ],
};

export default function BehaviorAnalyticsPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">محلل البيانات السلوكية</h1>
      <p className="mt-2 text-slate-600">
        الصق سجلاً بصيغة CSV أو JSON (أعمدة مثل: time, event, user_id). تحصل على توزيع
        الأحداث، أكثر المستخدمين نشاطاً، ونشاطاً زمنياً تقريباً — دون رفع الملفات لأي خادم.
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
