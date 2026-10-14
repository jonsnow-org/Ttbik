import type { Metadata } from "next";
import CreatorHub from "./CreatorHub";

export const metadata: Metadata = {
  title: "المنشئ | صانع التطبيقات والمساعد القانوني والدعم النفسي ومترجم اللهجات | شام AI",
  description:
    "منشئ شام AI: اصنع تطبيقاً مصغّراً لتيليجرام بالكلام، معلومات قانونية عامة ومسودات عقود، دعم نفسي أولي آمن، مترجم اللهجات العربية، محوّل المحتوى، ونقاط ومكافآت. مجاني بحدود يومية.",
};

export default function CreatePage() {
  return (
    <div dir="rtl" className="mx-auto max-w-4xl px-4 py-10">
      <span className="inline-block rounded-full bg-indigo-50 px-3 py-1 text-xs font-bold text-indigo-700">🆕 جديد · مجاني بحدود يومية</span>
      <h1 className="mt-3 text-3xl font-extrabold text-slate-900">المنشئ</h1>
      <p className="mt-2 text-slate-600">
        ست أدوات في مكان واحد، تعمل هنا على الموقع وكبوتات تيليجرام. كل استخدام يمنحك نقاطاً ترفع مستواك ويمكن استبدالها برصيد في «بشر».
      </p>
      <div className="mt-6">
        <CreatorHub />
      </div>
    </div>
  );
}
