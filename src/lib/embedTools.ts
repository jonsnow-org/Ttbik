// Tools that can be embedded in other sites via <iframe src="/embed/tools/<slug>">.
// Every embed shows a visible "تم التطوير بواسطة شام AI" backlink (the only
// condition of free embedding).
export const EMBED_TOOLS: Record<string, { title: string; height: number }> = {
  "bmi-calculator": { title: "حاسبة مؤشر كتلة الجسم", height: 640 },
  "zakat-calculator": { title: "حاسبة الزكاة", height: 760 },
  "hijri-converter": { title: "محوّل التاريخ الهجري والميلادي", height: 520 },
  "vat-calculator": { title: "حاسبة ضريبة القيمة المضافة", height: 560 },
  "profit-margin": { title: "حاسبة هامش الربح", height: 640 },
  "qr-generator": { title: "مولّد رمز QR", height: 760 },
  "life-counter": { title: "عدّاد العمر", height: 760 },
  "crypto-converter": { title: "محوّل العملات الرقمية", height: 560 },
};
