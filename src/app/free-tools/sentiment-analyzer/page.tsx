import type { Metadata } from "next";
import AdSlot from "@/components/AdSlot";
import SentimentAnalyzer from "./SentimentAnalyzer";

export const metadata: Metadata = {
  title: "محلل مشاعر النصوص مجاناً | شام AI",
  description:
    "حلّل مشاعر نص عربي أو إنجليزي فوراً في المتصفح — إيجابي/سلبي/محايد، بلا تسجيل ولا رفع لخادم.",
};

export default function SentimentAnalyzerPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12" dir="rtl" lang="ar">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">محلل مشاعر النصوص</h1>
      <p className="mt-2 text-slate-600">
        الصق تقييماً أو تعليقاً أو منشورًا — تظهر النتيجة فوراً داخل المتصفح دون إرسال النص لأي خادم.
      </p>
      <div className="mt-6">
        <SentimentAnalyzer />
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل محلل المشاعر" />
      </div>
    </div>
  );
}
