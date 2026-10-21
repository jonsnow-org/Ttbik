import type { Metadata } from "next";
import { toolMeta } from "@/lib/toolMeta";
import DateDifference from "./DateDifference";
import AdSlot from "@/components/AdSlot";
import ToolSeoSection from "@/components/ToolSeoSection";

export const metadata: Metadata = toolMeta("date-difference", {
  title: "حاسبة الفرق بين تاريخين وإضافة أيام | شام AI",
  description:
    "احسب الفرق بين تاريخين بالسنوات والشهور والأيام، أو أضف أيامًا إلى تاريخ — حاسبة أيام مجانية بالعربي.",
  keywords: ["حاسبة الأيام بين تاريخين", "الفرق بين تاريخين", "حساب عدد الأيام", "حاسبة العمر بالأيام", "اضافة ايام الى تاريخ"],
  alternates: { canonical: "/free-tools/date-difference" },
});

export default function Page() {
  return (
    <>
      <div className="mx-auto max-w-xl px-4 py-12">
        <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">🎁 أداة مجانية بالكامل</span>
        <h1 className="mt-3 text-2xl font-extrabold text-slate-900">حاسبة الفرق بين تاريخين</h1>
        <p className="mt-2 text-slate-600">اعرف عدد الأيام والأسابيع والشهور والسنوات بين تاريخين، أو احسب التاريخ بعد عدد معين من الأيام.</p>
        <div className="mt-6">
          <DateDifference />
        </div>
        <div className="mt-8">
          <AdSlot position="in-content" label="أسفل حاسبة الفرق بين تاريخين" />
        </div>
      </div>
      <ToolSeoSection slug="date-difference" />
    </>
  );
}
