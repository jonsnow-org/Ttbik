import type { Metadata } from "next";
import StoreNetProfitCalculator from "./StoreNetProfitCalculator";
import AdSlot from "@/components/AdSlot";
import ToolSeoSection from "@/components/ToolSeoSection";
import { SITE_URL } from "@/lib/siteUrl";

export const metadata: Metadata = {
  title: "حاسبة صافي ربح المتجر الإلكتروني | أدوات مجانية | شام AI",
  description: "احسب صافي ربح الطلب في متجرك بعد رسوم الدفع وعمولة المنصة والشحن والإعلان والمرتجعات، مع أقصى تكلفة إعلان دون خسارة. مجانية وتعمل في متصفحك.",
  alternates: { canonical: `${SITE_URL}/free-tools/store-net-profit` },
};

export default function StoreNetProfitPage() {
  return (
    <>
      <div className="mx-auto max-w-xl px-4 py-12">
        <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">🎁 أداة مجانية بالكامل</span>
        <h1 className="mt-3 text-2xl font-extrabold text-slate-900">حاسبة صافي ربح المتجر الإلكتروني</h1>
        <p className="mt-2 text-slate-600">
          أدخل سعر البيع والتكلفة والشحن ورسوم الدفع والإعلان ونسبة المرتجعات لتعرف ما يبقى لك فعلاً من كل طلب، وأقصى مبلغ إعلان يمكنك دفعه دون خسارة.
        </p>
        <div className="mt-6">
          <StoreNetProfitCalculator />
        </div>
        <div className="mt-10">
          <AdSlot position="in-content" label="أسفل حاسبة صافي ربح المتجر" />
        </div>
      </div>
      <ToolSeoSection slug="store-net-profit" />
    </>
  );
}
