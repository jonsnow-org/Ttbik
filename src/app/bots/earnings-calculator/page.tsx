import type { Metadata } from "next";
import EarningsCalculatorForm from "./EarningsCalculatorForm";

export const metadata: Metadata = {
  title: "حاسبة أرباح قناة أو بوت تليجرام | سوق تولز",
  description: "قدّر أرباحك الشهرية التقريبية من الإعلانات على قناة أو بوت تليجرام بناءً على مشاهداتك الحقيقية.",
};

export default function EarningsCalculatorPage() {
  return <EarningsCalculatorForm />;
}
