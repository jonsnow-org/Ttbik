import type { Metadata } from "next";
import { toolMeta } from "@/lib/toolMeta";
import SharedCosts from "./SharedCosts";
import AdSlot from "@/components/AdSlot";
import ToolSeoSection from "@/components/ToolSeoSection";

export const metadata: Metadata = toolMeta("shared-costs", {
  title: "تقسيم المصاريف بين الأصدقاء والرحلات | شام AI",
  description: "قسّم الفواتير ومصاريف السفر والسكن بين الأصدقاء بعدل، واعرف من يدفع لمن بأقل عدد من التحويلات. مجاني وبدون تسجيل.",
  keywords: ["تقسيم الفاتورة بين الأصدقاء", "تقسيم مصاريف السفر", "من يدفع لمن", "حاسبة مصاريف المجموعة", "تقسيم مصاريف السكن"],
  alternates: { canonical: "/free-tools/shared-costs" },
});

export default function Page() {
  return (
    <>
      <div className="mx-auto max-w-2xl px-4 py-12">
        <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">أداة مجانية · بلا تسجيل</span>
        <h1 className="mt-3 text-2xl font-extrabold text-slate-900">قسّم المصاريف بين الأصدقاء بسهولة</h1>
        <p className="mt-2 leading-7 text-slate-600">غداء جماعي أو رحلة أو سكن مشترك؟ أضف ما دفعه كل شخص، واختر من شارك في كل مصروف، وستحسب الأداة الرصيد وتقترح تسوية واضحة بأقل عدد من التحويلات.</p>
        <div className="mt-6"><SharedCosts /></div>
        <div className="mt-8"><AdSlot position="in-content" label="أسفل أداة تقسيم المصاريف" /></div>
      </div>
      <ToolSeoSection slug="shared-costs" />
    </>
  );
}
