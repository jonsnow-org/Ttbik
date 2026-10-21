import type { Metadata } from "next";
import { toolMeta } from "@/lib/toolMeta";
import CryptoConverter from "./CryptoConverter";
import AdSlot from "@/components/AdSlot";
import ToolSeoSection from "@/components/ToolSeoSection";

export const metadata: Metadata = toolMeta("crypto-converter", {
  title: "محول عملات رقمية (TON / BTC / ETH) | أدوات مجانية | شام AI",
  description:
    "حوّل بين TON وبيتكوين وإيثريوم وUSDT والدولار والريال بأسعار حية — مجاناً بلا تسجيل. مفيد أيضاً لمستخدمي محفظة TON على شام AI.",
});

function CryptoConverterPageBody() {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <span className="inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
        🎁 أداة مجانية بالكامل
      </span>
      <h1 className="mt-3 text-2xl font-extrabold text-slate-900">محول العملات الرقمية</h1>
      <p className="mt-2 text-slate-600">
        أسعار حية لـ TON وBTC وETH وUSDT مقابل الدولار والريال السعودي. مناسب لتقدير قيمة
        التحويلات — وبشكل خاص لمستخدمي محفظة TON الموجودة في بوتات الإعلانات على شام AI.
      </p>
      <div className="mt-6">
        <CryptoConverter />
      </div>
      <div className="mt-8">
        <AdSlot position="in-content" label="أسفل محول العملات" />
      </div>
    </div>
  );
}

export default function CryptoConverterPage() {
  return (
    <>
      <CryptoConverterPageBody />
      <ToolSeoSection slug="crypto-converter" />
    </>
  );
}
