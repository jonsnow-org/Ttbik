// 🧰 Free tools that sell a sponsor line ("برعاية …") through the promo section (/sponsor). One list for the order route,
// the order form and the slot itself. Ordered by real traffic (page_views, Oct–Nov 2026): QR and zakat lead.
export const SPONSOR_TOOLS = [
  { id: "qr-generator", label: "مولّد QR" },
  { id: "zakat-calculator", label: "حاسبة الزكاة" },
  { id: "image-optimizer", label: "ضغط الصور" },
  { id: "vat-calculator", label: "حاسبة الضريبة" },
  { id: "percentage-calculator", label: "النسبة المئوية" },
  { id: "whatsapp-link", label: "رابط واتساب" },
  { id: "invoice-generator", label: "منشئ الفواتير" },
  { id: "cv-generator", label: "منشئ السيرة الذاتية" },
  { id: "hijri-converter", label: "التحويل الهجري" },
  { id: "url-shortener", label: "اختصار الروابط" },
  { id: "bmi-calculator", label: "حاسبة الوزن" },
  { id: "guess-word", label: "تحدي الكلمة" },
] as const;
export const SPONSOR_TOOL_IDS: ReadonlySet<string> = new Set(SPONSOR_TOOLS.map((t) => t.id));
/** Pages that already place <ToolSponsor> themselves (the free-tools layout adds it everywhere else). */
export const OWN_SPONSOR_SLOT: ReadonlySet<string> = new Set(["qr-generator", "bmi-calculator", "guess-word"]);
