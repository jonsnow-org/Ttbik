// Per-card color cycle so the free-tools grid reads as colorful instead of
// a wall of identical white cards (owner feedback, 2026-09-20). Full literal
// class strings are required here (not composed at runtime) so Tailwind's
// build-time scanner actually generates them — same convention as
// categoryTheme.ts's groupHoverText comment.
export const FREE_TOOL_THEMES = [
  { bg: "bg-emerald-50", border: "border-emerald-200", badgeBg: "bg-emerald-100", badgeText: "text-emerald-700", accent: "from-emerald-400 to-emerald-600", hoverText: "group-hover:text-emerald-700" },
  { bg: "bg-sky-50", border: "border-sky-200", badgeBg: "bg-sky-100", badgeText: "text-sky-700", accent: "from-sky-400 to-sky-600", hoverText: "group-hover:text-sky-700" },
  { bg: "bg-amber-50", border: "border-amber-200", badgeBg: "bg-amber-100", badgeText: "text-amber-700", accent: "from-amber-400 to-amber-600", hoverText: "group-hover:text-amber-700" },
  { bg: "bg-rose-50", border: "border-rose-200", badgeBg: "bg-rose-100", badgeText: "text-rose-700", accent: "from-rose-400 to-rose-600", hoverText: "group-hover:text-rose-700" },
  { bg: "bg-violet-50", border: "border-violet-200", badgeBg: "bg-violet-100", badgeText: "text-violet-700", accent: "from-violet-400 to-violet-600", hoverText: "group-hover:text-violet-700" },
  { bg: "bg-teal-50", border: "border-teal-200", badgeBg: "bg-teal-100", badgeText: "text-teal-700", accent: "from-teal-400 to-teal-600", hoverText: "group-hover:text-teal-700" },
  { bg: "bg-orange-50", border: "border-orange-200", badgeBg: "bg-orange-100", badgeText: "text-orange-700", accent: "from-orange-400 to-orange-600", hoverText: "group-hover:text-orange-700" },
  { bg: "bg-fuchsia-50", border: "border-fuchsia-200", badgeBg: "bg-fuchsia-100", badgeText: "text-fuchsia-700", accent: "from-fuchsia-400 to-fuchsia-600", hoverText: "group-hover:text-fuchsia-700" },
] as const;

export function getFreeToolTheme(index: number) {
  return FREE_TOOL_THEMES[index % FREE_TOOL_THEMES.length];
}

// Shared list of the site's free browser tools — single source of truth
// for both /free-tools (full listing) and the homepage showcase, so a new
// tool only needs to be added here once instead of drifting between pages.
export const FREE_TOOLS = [
  {
    href: "/free-tools/bmi-calculator",
    title: "حاسبة مؤشر كتلة الجسم BMI والوزن المثالي",
    desc: "احسب BMI والتصنيف (نحافة/طبيعي/زيادة/سمنة) والوزن المثالي التقريبي — فوري وبلا تسجيل.",
  },
  {
    href: "/free-tools/qr-generator",
    title: "مولّد رمز QR",
    desc: "أنشئ رمز QR لأي رابط أو نص — حجم وألوان قابلة للتخصيص وتنزيل PNG فوري داخل المتصفح.",
  },
  {
    href: "/free-tools/zakat-calculator",
    title: "حاسبة الزكاة الذكية",
    desc: "احسب زكاة النقد والذهب والفضة والأسهم وعروض التجارة — نصاب قابل للتعديل و2.5% فوري.",
  },
  {
    href: "/free-tools/hijri-converter",
    title: "محوّل التاريخ الهجري والميلادي",
    desc: "حوّل أي تاريخ بين الهجري والميلادي مع أسماء الأشهر العربية واسم اليوم — فوري وبلا تسجيل.",
  },
  {
    href: "/free-tools/profit-margin",
    title: "حاسبة هامش الربح ونقطة التعادل",
    desc: "احسب هامش الربح ونسبة الإضافة ونقطة التعادل من تكلفة الوحدة وسعر البيع — فوري وبلا تسجيل.",
  },
  {
    href: "/free-tools/vat-calculator",
    title: "حاسبة ضريبة القيمة المضافة (VAT)",
    desc: "احسب ضريبة القيمة المضافة للدول العربية (15% السعودية، 5% الإمارات، 14% مصر…) — قبل أو شامل الضريبة.",
  },
  {
    href: "/free-tools/crypto-converter",
    title: "محول عملات رقمية (TON / BTC / ETH)",
    desc: "أسعار حية لـ TON وبيتكوين وإيثريوم وUSDT مقابل الدولار والريال — مفيد لمحفظة TON.",
  },
  {
    href: "/free-tools/invoice-generator",
    title: "مولّد فواتير وعقود بسيطة",
    desc: "فاتورة أو عقد خدمة عربي جاهز للطباعة/PDF — بنود، ضريبة، توقيعات. بلا تسجيل.",
  },
  {
    href: "/free-tools/cv-generator",
    title: "مولّد سيرة ذاتية عربي + PDF",
    desc: "أنشئ سيرة ذاتية عربية احترافية واحفظها كـ PDF من المتصفح — نص عربي صحيح، بلا تسجيل.",
  },
  {
    href: "/free-tools/digital-card",
    title: "بطاقة أعمال رقمية (Linktree)",
    desc: "صفحة روابط واحدة: اسم، نبذة، صورة، وأزرار روابط — مع عداد مشاهدات حقيقي.",
  },
  {
    href: "/free-tools/url-shortener",
    title: "مصغّر روابط + عداد نقرات",
    desc: "اختصر أي رابط واحصل على رابط قصير على نطاق الموقع مع عداد نقرات حقيقي.",
  },
  {
    href: "/free-tools/image-optimizer",
    title: "ضغط وتحويل الصور (WebP/JPEG/PNG)",
    desc: "اضغط صورك وحوّل صيغتها فوراً داخل متصفحك — بلا رفع لأي خادم وبلا حدود استخدام.",
  },
  {
    href: "/free-tools/whatsapp-link",
    title: "مولد رابط الطلب عبر واتساب",
    desc: "رابط جاهز يفتح محادثة واتساب مع رسالة طلب معبّأة تلقائياً لمنتجك.",
  },
  {
    href: "/free-tools/business-name-generator",
    title: "مولد أسماء المشاريع والمتاجر",
    desc: "8 اقتراحات أسماء لمشروعك خلال ثوانٍ بالذكاء الاصطناعي.",
  },
  {
    href: "/free-tools/logo-generator",
    title: "مولّد الشعارات النصية العربية",
    desc: "شعار نصي (wordmark) عربي جاهز خلال ثوانٍ — خطوط وتنسيقات ألوان حقيقية، تنزيل PNG فوري.",
  },
  {
    href: "/free-tools/writing-assistant",
    title: "مساعد الكتابة الذكي",
    desc: "منشور سوشيال ميديا، مقالة مدونة، وصف منتج، أو ترجمة نص عمل — بالذكاء الاصطناعي.",
  },
  {
    href: "/free-tools/text-analyzer",
    title: "محلل النصوص الذكي",
    desc: "لخّص تقريراً طويلاً، أو حلّل تقييمات عملائك بالجملة مع رد مقترح لكل واحد.",
  },
] as const;
