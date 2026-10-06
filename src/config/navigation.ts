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
  { id: "articles", href: "/articles", label: "✍️ المقالات" },
] as const;

export type EditorialTabId = (typeof EDITORIAL_TABS)[number]["id"];

/** قسم القائمة الجانبية (MobileNav) */
export const SIDEBAR_EDITORIAL_SECTION: NavSection = {
  label: "المدونة والأخبار",
  links: EDITORIAL_TABS.map((t) => ({ id: t.id, href: t.href, label: t.label })),
};
