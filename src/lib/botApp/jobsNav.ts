// Navigation map of the jobs & store Mini App (src/app/bot-app/[botId]/JobsMiniApp.tsx). Pure, so it is unit-tested.
export type NavScreen = { name: string; params?: Record<string, string> };

/** The five main sections shown in the bottom bar. */
export const MAIN_TABS = [
  { name: "home", icon: "🏠", label: "الرئيسية" },
  { name: "store", icon: "🛒", label: "المتجر" },
  { name: "work", icon: "💼", label: "العمل" },
  { name: "orders", icon: "📂", label: "نشاطي" },
  { name: "account", icon: "👤", label: "حسابي" },
] as const;

/** Where a deep link / bot button (`?s=<section>`) lands. Links made before the reorganisation keep working: shops, my shop and tenders are now segments of a hub. */
export function sectionScreen(section: string): NavScreen {
  switch (section) {
    case "store": case "work": case "orders": case "account": return { name: section };
    case "shops": return { name: "store", params: { tab: "shops" } };
    case "myshop": return { name: "orders", params: { tab: "myshop" } };
    case "tenders": return { name: "work", params: { tab: "tenders" } };
    default: return { name: "home" };
  }
}
