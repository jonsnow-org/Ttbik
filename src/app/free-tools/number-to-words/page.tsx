import type { Metadata } from "next";
import { toolMeta } from "@/lib/toolMeta";
import NumberToWords from "./NumberToWords";
import AdSlot from "@/components/AdSlot";
import ToolSeoSection from "@/components/ToolSeoSection";

export const metadata: Metadata = toolMeta("number-to-words", {
  title: "تفقيط الأرقام: تحويل الرقم إلى حروف بالعربي | شام AI",
  description:
    "تفقيط الأرقام وتحويل المبلغ إلى كتابة بالحروف العربية (ريال، دينار، جنيه، درهم، دولار) — أداة مجانية للشيكات والفواتير والعقود، بلا تسجيل.",
  keywords: ["تفقيط الأرقام", "تحويل الرقم إلى حروف", "كتابة المبلغ بالحروف", "تفقيط المبلغ", "تفقيط ريال سعودي"],
  alternates: { canonical: "/free-tools/number-to-words" },
});

export default function Page() {
  return (
    <>
      <div className="mx-auto max-w-xl px-4 py-12">
        <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">🎁 أداة مجانية بالكامل</span>
        <h1 className="mt-3 text-2xl font-extrabold text-slate-900">تفقيط الأرقام — تحويل الرقم أو المبلغ إلى حروف عربية</h1>
        <p className="mt-2 text-slate-600">اكتب أي رقم أو مبلغ مالي فتحصل فوراً على كتابته بالحروف العربية مع اسم العملة والكسور، جاهزاً للنسخ في الشيكات والفواتير والعقود.</p>
        <div className="mt-6">
          <NumberToWords />
        </div>
        <div className="mt-8">
          <AdSlot position="in-content" label="أسفل تفقيط الأرقام (رقم إلى حروف عربية)" />
        </div>
      </div>
      <ToolSeoSection slug="number-to-words" />
    </>
  );
}
