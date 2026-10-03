import type { Metadata } from "next";
import TextAnalyzer from "./TextAnalyzer";
import AdSlot from "@/components/AdSlot";

export const metadata: Metadata = {
  title: "محلل النصوص الذكي مجاناً | شام AI",
  description: "لخّص تقاريرك الطويلة، أو حلّل آراء عملائك بالجملة مع رد مقترح جاهز لكل واحد — بالذكاء الاصطناعي، مجاناً.",
};

export default function TextAnalyzerPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">محلل النصوص الذكي</h1>
      <p className="mt-2 text-slate-600">
        لخّص تقريراً طويلاً إلى أهم نقاطه وتوصية واحدة، أو الصق تقييمات عملائك واحصل على تصنيف ورد مقترح لكل
        واحد — خلال ثوانٍ.
      </p>
      <div className="mt-6">
        <TextAnalyzer />
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل محلل النصوص" />
      </div>
    </div>
  );
}
