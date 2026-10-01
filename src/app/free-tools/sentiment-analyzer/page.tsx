import type { Metadata } from "next";
import SentimentAnalyzer from "./SentimentAnalyzer";
import AdSlot from "@/components/AdSlot";

export const metadata: Metadata = {
  title: "محلل المشاعر للنصوص العربية مجاناً | سوق تولز",
  description:
    "حلّل مشاعر أي نص عربي أو إنجليزي فوراً: إيجابي، سلبي أو محايد مع درجة الثقة والكلمات المؤثرة. مجاني بلا تسجيل — مثالي لتقييمات العملاء والتعليقات.",
  keywords: [
    "تحليل المشاعر",
    "تحليل السنتيمنت",
    "Sentiment Analysis",
    "تحليل تعليقات العملاء",
    "تحليل نصوص عربية",
    "أدوات مجانية",
  ],
};

export default function SentimentAnalyzerPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">محلل المشاعر للنصوص</h1>
      <p className="mt-2 text-slate-600">
        الصق نصاً أو عدة تعليقات (سطراً لكل تعليق) لتحصل على تصنيف المشاعر، الدرجة،
        والكلمات الأقوى تأثيراً. يعمل داخل المتصفح دون إرسال نصوصك لخوادم خارجية.
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
