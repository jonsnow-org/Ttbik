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
    // No "?start=8144671083" payload -- a real bug found 2026-09-22: this
    // public showcase link was carrying a referral payload, so EVERY
    // organic visitor who tried the bot from here got silently attributed
    // as "referred by" that one Telegram id (see adBotLogic.ts's /start
    // handler), which pays that id a real 5% cut of the referred user's
    // task earnings forever and could falsely win them the "invite 500"
    // contest. A public demo link must never carry anyone's personal
    // referral code.
    href: "https://t.me/AdsClicsBot",
    title: "بوت الإعلانات والمهام",
    desc: "أنشئ إعلانك وحدد الميزانية والسعر، أو ابدأ الربح من مشاهدة الإعلانات.",
  },
  // NOVA_BOT is the one other template meant to be public-facing (see
  // docs/AGENT_BUS.md's product rules -- MARRIAGE_BOT/JOBS_BOT/MEDICAL_BOT
  // stay excluded here, deliberately, they are owner-only and must never be
  // listed). Shown only once the owner sets the bot's real @username, same
  // defensive "silently skip until configured" pattern as
  // getBotPromos() in api/cron/telegram-post/route.ts -- never fabricate a
  // link.
  ...(process.env.NEXT_PUBLIC_PROMO_NOVA_BOT_USERNAME
    ? [
        {
          href: `https://t.me/${process.env.NEXT_PUBLIC_PROMO_NOVA_BOT_USERNAME}`,
          title: "Nova AI — مساعدك الذكي",
          desc: "مساعد ذكاء اصطناعي يجاوبك ويساعدك في أي شيء، مباشرة على تليجرام.",
        },
      ]
    : []),
] as const;
