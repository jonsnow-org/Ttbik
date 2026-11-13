// Navigation map of the jobs & store Mini App (src/app/bot-app/[botId]/JobsMiniApp.tsx). It follows the bot's own main menu (src/lib/jobsBotLogic.ts mainMenu):
//   💼 قسم العمل · 🛒 قسم المتجر (تصفح، طلباتي، متجري) · 🏷 اطلب وهم يتنافسون · 👤 ملفي الشخصي · 💰 رصيدي وإيداع · 🛍 متاجر البائعين · ℹ️ معلومات.
// Pure, so it is unit-tested.
export type NavScreen = { name: string; params?: Record<string, string> };

/** The bottom bar: the bot's top-level sections (the bot's wallet, profile and info buttons are grouped under «ملفي»). */
export const MAIN_TABS = [
  { name: "home", icon: "🏠", label: "الرئيسية" },
  { name: "work", icon: "💼", label: "العمل" },
  { name: "store", icon: "🛒", label: "المتجر" },
  { name: "tenders", icon: "🏷", label: "اطلب" },
  { name: "account", icon: "👤", label: "ملفي" },
] as const;

/** Where a deep link / bot button (`?s=<section>`) lands. «orders» and «myshop» are segments of the store section, as in the bot (📂 طلباتي، 🏪 متجري inside 🛒 قسم المتجر). */
export function sectionScreen(section: string): NavScreen {
  switch (section) {
    case "store": case "work": case "tenders": case "account": return { name: section };
    case "orders": return { name: "store", params: { tab: "orders" } };
    case "myshop": return { name: "store", params: { tab: "myshop" } };
    case "shops": return { name: "shops" };
    default: return { name: "home" };
  }
}
