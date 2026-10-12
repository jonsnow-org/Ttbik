"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOLS: Record<string, ComponentType<any>> = {
  "bmi-calculator": dynamic(() => import("@/app/free-tools/bmi-calculator/BmiCalculator")),
  "zakat-calculator": dynamic(() => import("@/app/free-tools/zakat-calculator/ZakatCalculator")),
  "hijri-converter": dynamic(() => import("@/app/free-tools/hijri-converter/HijriConverter")),
  "vat-calculator": dynamic(() => import("@/app/free-tools/vat-calculator/VatCalculator")),
  "profit-margin": dynamic(() => import("@/app/free-tools/profit-margin/ProfitMarginCalculator")),
  "qr-generator": dynamic(() => import("@/app/free-tools/qr-generator/QrGenerator")),
  "life-counter": dynamic(() => import("@/app/free-tools/life-counter/LifeCounter")),
  "crypto-converter": dynamic(() => import("@/app/free-tools/crypto-converter/CryptoConverter")),
};

export default function EmbeddedTool({ slug }: { slug: string }) {
  const Tool = TOOLS[slug];
  if (!Tool) return null;
  return <Tool />;
}
