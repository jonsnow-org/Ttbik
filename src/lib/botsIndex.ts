// Practical index of every hosted bot template (except Athar, Zenobia and Palmyra Launch).
// One place to see which file owns which template, its Mini App (if any), and the public landing slug.
// Keep this file short and accurate; the real logic lives in the *BotLogic.ts files listed below.

export type BotIndexEntry = {
  template: string;
  logicFile: string;
  landingSlug?: string;
  miniApp?: string;
  notes: string;
};

export const BOTS_INDEX: BotIndexEntry[] = [
  {
    template: "AD_BOT",
    logicFile: "src/lib/adBotLogic.ts",
    landingSlug: "ads-and-earn",
    miniApp: "/bot-app/[botId] (AD_BOT)",
    notes: "Ads & earn builder. Reply-keyboard only except carousel. Revenue 50/20/30. Stars + crypto deposits.",
  },
  {
    template: "JOBS_BOT",
    logicFile: "src/lib/jobsBotLogic.ts",
    landingSlug: "jobs-and-store",
    miniApp: "/bot-app/[botId] (JOBS_BOT)",
    notes: "Jobs + store + tenders. Escrow with 7-day auto-release. Independent tables.",
  },
  {
    template: "MARRIAGE_BOT",
    logicFile: "src/lib/matchBotLogic.ts",
    landingSlug: "dating-marriage",
    miniApp: "/match-app/[botId]",
    notes: "Dating/marriage. Inline only on cards and random chat. Stars + TON. Arabic-only.",
  },
  {
    template: "MEDICAL_BOT",
    logicFile: "src/lib/medicalBotLogic.ts",
    landingSlug: "medical",
    notes: "Patient / clinic / hospital / pharmacy roles. Blood bank in medBloodBank.ts. Day-before reminders only.",
  },
  {
    template: "CONFESSION_BOT",
    logicFile: "src/lib/confessionBotLogic.ts",
    landingSlug: "confessions",
    notes: "Anonymous confessions box. Reveal-sender and unlimited-replies unlocks. Stars credited before any gate.",
  },
  {
    template: "STREAK_BOT",
    logicFile: "src/lib/streakBotLogic.ts",
    miniApp: "/bot-app/[botId] (STREAK_BOT)",
    notes: "Daily streaks + group khatma + contests. Widget support. Owner can switch to user panel.",
  },
  {
    template: "CAPSULE_BOT",
    logicFile: "src/lib/capsuleBotLogic.ts",
    notes: "Time capsules (self or friend). Delivered by /api/cron/time-capsules. No payment.",
  },
  {
    template: "QUIZ_BOT",
    logicFile: "src/lib/quizBotLogic.ts",
    notes: "Static personality quizzes. No AI, no user-generated content.",
  },
  {
    template: "NAME_COMPAT_BOT",
    logicFile: "src/lib/nameCompatBotLogic.ts",
    notes: "Name compatibility. Isolated template.",
  },
  {
    template: "PRAYER_BOT",
    logicFile: "src/lib/prayerBotLogic.ts",
    notes: "Prayer times / reminders. Isolated template.",
  },
  {
    template: "FADAA_BOT",
    logicFile: "src/lib/fadaaBotLogic.ts",
    notes: "Isolated template. See its own file for details.",
  },
  {
    template: "NOVA_BOT",
    logicFile: "src/lib/novaBotLogic.ts + src/lib/coderSections.ts",
    notes: "Coder / Sham engine. Routes through handleCoderSections first; Sham falls back to novaBotLogic.",
  },
  {
    template: "CHANNEL_PUBLISH_BOT",
    logicFile: "src/lib/channelPublisher.ts + src/lib/channelPool.ts",
    notes: "Publishes to the site channel on a schedule. No user panel. HTML escaping fixed in channelPool.",
  },
  {
    template: "HUB_*",
    logicFile: "src/lib/hubBotLogic.ts",
    notes: "Creator hub templates. Tables created on first use.",
  },
];

/** Templates deliberately excluded from this index (owned by other sections). */
export const EXCLUDED_TEMPLATES = ["ATHAR_BOT", "ZENOBIA_BOT", "ZNBT_PLATFORM_BOT"] as const;
