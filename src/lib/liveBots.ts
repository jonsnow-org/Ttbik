// Real, live Telegram bots the owner runs — single source of truth for
// the free-tools page, the homepage, and the telegram-post promo cron, so
// a new bot (or a change to one) only needs to be added here once.
//
// Owner directive 2026-09-23: the bot TEMPLATES stay private (deploying a
// copy of a template is owner-only), but the owner's own running bots are
// meant to be advertised publicly — each card links straight to the bot on
// Telegram, never to the builder/template page on the site. Links and
// wording are the owner's own.
//
// Never put a ?start=<id> payload on these links: adBotLogic.ts treats any
// /start payload as a referral, which would credit every visitor from a
// public card to one account (real bug fixed 2026-09-22).
export const LIVE_BOTS = [
  {
    href: "https://t.me/AdsClicsBot",
    title: "بوت الإعلان والربح",
    desc: "روّج لمشروعك لجمهور حقيقي، أو نفّذ مهاماً يومية واكسب أرباحاً حقيقية.",
  },
  {
    href: "https://t.me/ArabicAds_bot",
    title: "بوت تحميل الوسائط",
    desc: "حمّل الفيديو والصوت والصور من جميع منصات التواصل — أرسل الرابط واحصل على ملفك بأعلى جودة.",
  },
  {
    href: "https://t.me/Saragptbotbot",
    title: "بوت فرص العمل والمتجر",
    desc: "بوابتك الشاملة لفرص العمل والوظائف اليومية، وأفضل المنتجات والعروض في متجر البيع والشراء.",
  },
  {
    href: "https://t.me/Saragptbot",
    title: "بوت التعارف والزواج",
    desc: "هنا تلتقي الأرواح الطيبة.. خطوتك الأولى لإيجاد الشريك.",
  },
  {
    href: "https://t.me/Adsbyeadsbot",
    title: "البوت الطبي",
    desc: "بوت طبي مخصص بالأدوار لكل من المرضى والأطباء والصيادلة والعيادات والمشافي.",
  },
] as const;
