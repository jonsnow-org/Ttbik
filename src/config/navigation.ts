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

/**
 * Services that live inside the daily chains bot (@Slaselbot) and its own Mini App (owner, phase 2): other bots and Mini Apps
 * link there with a t.me deep link (/start khatma, /start contest opens the section) instead of the website page.
 */
export const CHAINS_BOT_USERNAME = "Slaselbot";
export const IN_CHAINS_BOT: Partial<Record<(typeof SERVICE_LINKS)[number]["id"], string>> = { khatma: "khatma", contests: "contest" };
/**
 * Seller shops live inside the jobs & store bot (@Saragptbotbot) and its own Mini App (owner, phase 3): other bots and Mini
 * Apps link there with a t.me deep link (/start shops opens the shops section) instead of the website page.
 */
export const STORE_BOT_USERNAME = "Saragptbotbot";
export const IN_STORE_BOT: Partial<Record<(typeof SERVICE_LINKS)[number]["id"], string>> = { shop: "shops" };
/** t.me deep link for a service that lives inside one of the platform's own bots (khatma/contests → chains bot, shops → store bot), else null. */
export function chainsBotLink(id: string, username: string = CHAINS_BOT_USERNAME): string | null {
  const store = IN_STORE_BOT[id as keyof typeof IN_STORE_BOT];
  if (store) return `https://t.me/${STORE_BOT_USERNAME}?start=${store}`;
  const payload = IN_CHAINS_BOT[id as keyof typeof IN_CHAINS_BOT];
  return payload ? `https://t.me/${(username || CHAINS_BOT_USERNAME).replace(/^@/, "")}?start=${payload}` : null;
}

/**
 * Remittances and the channel exchange live inside the platform bot (@Sham_test0_bot) and its own Mini App (owner, phase 5):
 * the site bot links there with a t.me deep link (/start remit, /start exchange open that Mini App section).
 */
export const REMIT_BOT_USERNAME = "Sham_test0_bot";
export const IN_REMIT_BOT: Partial<Record<(typeof SERVICE_LINKS)[number]["id"], string>> = { remit: "remit", channels: "exchange" };
/**
 * The site bot's (@Admen10bot) «🧭 خدمات وأرباح» (owner, phase 5): every entry opens the bot that hosts it; the free channel audit
 * is dropped. «📣 أعلن على الموقع» is the site bot's own service (the site Mini App), so it stays a site page.
 */
export const SITE_BOT_SERVICE_IDS = ["remit", "channels", "advertise", "khatma", "contests", "shop"] as const;
/** Deep link into the bot that hosts a service (khatma/contests → chains bot, shops → store bot, remit/channels → platform bot), else null. */
export function serviceBotLink(id: string, chainsBot: string = CHAINS_BOT_USERNAME): string | null {
  const remit = IN_REMIT_BOT[id as keyof typeof IN_REMIT_BOT];
  if (remit) return `https://t.me/${REMIT_BOT_USERNAME}?start=${remit}`;
  return chainsBotLink(id, chainsBot);
}

export const SIDEBAR_SERVICES_SECTION: NavSection = {
  label: "خدمات وأرباح",
  links: SERVICE_LINKS.map((s) => ({ id: s.id, href: s.href, label: s.label })),
};
