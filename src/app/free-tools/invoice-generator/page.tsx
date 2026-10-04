import type { Metadata } from "next";
import InvoiceGenerator from "./InvoiceGenerator";
import AdSlot from "@/components/AdSlot";

export const metadata: Metadata = {
  title: "مولّد فواتير وعقود بسيطة بالعربي | أدوات مجانية | شام AI",
  description:
    "أنشئ فاتورة أو عقد خدمة بسيط بالعربي مجاناً واحفظه كـ PDF من المتصفح — بدون تسجيل، نص عربي صحيح.",
};

export default function InvoiceGeneratorPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">مولّد الفواتير والعقود البسيطة</h1>
      <p className="mt-2 text-slate-600">
        املأ البيانات، شاهد المعاينة فوراً، ثم اطبع أو احفظ كـ PDF. مناسب لفواتير الخدمات الصغيرة
        وعقود العمل البسيطة — بلا مكتبات خارجية وبلا تكلفة.
      </p>
      <div className="mt-8">
        <InvoiceGenerator />
      </div>
      <div className="mt-8 print:hidden">
        <AdSlot position="in-content" label="أسفل مولّد الفواتير" />
      </div>
    </div>
  );
}
