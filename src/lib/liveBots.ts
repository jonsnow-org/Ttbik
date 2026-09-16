// Real, live Telegram bots the owner runs — single source of truth for
// the free-tools page, the homepage, and the telegram-post promo cron, so
// a new bot (or a change to one) only needs to be added here once.
//
// IMPORTANT: only list bots here that are actually meant to be publicly
// advertised. MARRIAGE_BOT and JOBS_BOT are explicitly private,
// owner-only templates per docs/AGENT_BUS.md's product rules ("never
// listed anywhere" / "never sold or activated for anyone else") — they
// were found live here on 2026-09-16 (a real bug: this list was publicly
// exposing direct t.me links to both on the homepage, /free-tools, and
// the telegram-post promo cron) and removed. Never re-add a bot here
// without checking its product rule in AGENT_BUS.md first.
export const LIVE_BOTS = [
  {
    href: "https://t.me/AdsClicsBot?start=8144671083",
    title: "بوت الإعلانات والمهام",
    desc: "أنشئ إعلانك وحدد الميزانية والسعر، أو ابدأ الربح من مشاهدة الإعلانات.",
  },
] as const;
