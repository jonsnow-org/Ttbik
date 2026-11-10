export interface NavItem {
  id: string;
  href: string;
  label: string;
}

export interface NavSection {
  label: string;
  links: NavItem[];
}

/** أقسام مركز المدونة والأخبار — مصدر واحد للتبويبات والقائمة والرئيسية */
export const EDITORIAL_TABS = [
  { id: "news", href: "/news", label: "📰 الأخبار" },
  { id: "events", href: "/events", label: "🗓️ الأحداث" },
  { id: "upcoming", href: "/events/upcoming", label: "⏳ القادمة" },
  { id: "articles", href: "/articles", label: "✍️ المقالات" },
] as const;

export type EditorialTabId = (typeof EDITORIAL_TABS)[number]["id"];

/** قسم القائمة الجانبية (MobileNav) */
export const SIDEBAR_EDITORIAL_SECTION: NavSection = {
  label: "المدونة والأخبار",
  links: [
    ...EDITORIAL_TABS.map((t) => ({ id: t.id, href: t.href, label: t.label })),
    { id: "coffee", href: "/coffee", label: "☕ قهوة للموقع" },
  ],
};

/**
 * Services that earn or help people directly (owner, 2026-11-10: «I could not find them from the site»).
 * One source for the side menu, the footer and the home page section.
 */
export const SERVICE_LINKS = [
  { id: "remit", href: "/remit", label: "💸 حوالات USDT", desc: "بدّل وأرسل USDT لأي محفظة خلال دقائق." },
  { id: "channels", href: "/channels", label: "📢 بورصة القنوات", desc: "إعلانات قنوات تيليجرام بضمان الدفع حتى يُنشر الإعلان." },
  { id: "channel-audit", href: "/channel-audit", label: "🔎 فحص قناة مجاناً", desc: "نسبة المشاهدة الحقيقية والسعر العادل لأي قناة عامة." },
  { id: "advertise", href: "/advertise", label: "📣 أعلن على الموقع", desc: "بنرات ورعاية أدوات بأسعار واضحة، والدفع بالنجوم أو العملات الرقمية." },
  { id: "khatma", href: "/khatma", label: "📖 الختمة الجماعية", desc: "ختمة قرآن لجروبك، أو ختمة صدقة جارية باسم من تحب." },
  { id: "contests", href: "/contests", label: "🏆 مسابقات الجروبات", desc: "أسئلة مجانية في جروبات تيليجرام ولوحة صدارة أسبوعية بجوائز من الرعاة." },
  { id: "shop", href: "/shop", label: "🛍 متاجر البائعين", desc: "متاجر أعضاء بوت فرص العمل والمتجر، والطلب عبر البوت." },
] as const;

export const SIDEBAR_SERVICES_SECTION: NavSection = {
  label: "خدمات وأرباح",
  links: SERVICE_LINKS.map((s) => ({ id: s.id, href: s.href, label: s.label })),
};
