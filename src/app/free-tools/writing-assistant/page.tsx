import type { Metadata } from "next";
import WritingAssistant from "./WritingAssistant";
import AdSlot from "@/components/AdSlot";

export const metadata: Metadata = {
  title: "مساعد الكتابة الذكي مجاناً | شام AI",
  description: "منشورات سوشيال ميديا، مقالات مدونة، أوصاف منتجات، وترجمة نصوص عمل — بالذكاء الاصطناعي، مجاناً وبدون تسجيل.",
};

export default function WritingAssistantPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">مساعد الكتابة الذكي</h1>
      <p className="mt-2 text-slate-600">
        اختر ما تحتاجه: منشور سوشيال ميديا، مقالة مدونة، وصف منتج، أو ترجمة نص عمل — يكتبه لك الذكاء الاصطناعي
        خلال ثوانٍ.
      </p>
      <div className="mt-6">
        <WritingAssistant />
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل مساعد الكتابة" />
      </div>
    </div>
  );
}
