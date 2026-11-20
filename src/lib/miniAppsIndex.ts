// Practical index of Telegram Mini Apps (excluding Athar / Zenobia / Palmyra).
// Each app is a standalone page (no site chrome) that only works inside Telegram
// because every API call requires initData signed by the bot's own token.

export type MiniAppIndexEntry = {
  path: string;
  templates: string[];
  pageFile: string;
  apiRoute: string;
  serverLogic: string[];
  notes: string;
};

export const MINI_APPS_INDEX: MiniAppIndexEntry[] = [
  {
    path: "/bot-app/[botId]",
    templates: ["AD_BOT", "STREAK_BOT", "JOBS_BOT"],
    pageFile: "src/app/bot-app/[botId]/page.tsx",
    apiRoute: "src/app/api/bot-app/[botId]/route.ts",
    serverLogic: [
      "src/lib/botApp/adApp.ts (AD_BOT)",
      "src/lib/botApp/streakApp.ts (STREAK_BOT)",
      "src/lib/botApp/jobsApp.ts (JOBS_BOT)",
    ],
    notes: "Chosen by bot.template. Sections via ?s=. Remittances and channel exchange earn 100% for the platform.",
  },
  {
    path: "/match-app/[botId]",
    templates: ["MARRIAGE_BOT"],
    pageFile: "src/app/match-app/[botId]/page.tsx",
    apiRoute: "src/app/api/match-app/[botId]/route.ts",
    serverLogic: ["src/app/match-app/[botId]/MatchMiniApp.tsx", "src/lib/match/**"],
    notes: "Dating/marriage Mini App. Separate from the bot-app router.",
  },
];

/** Outside Telegram the pages show a clear "open from the bot" message and refuse API calls without valid initData. */
export const MINI_APP_GUARD_NOTE =
  "Every action is rejected with 401 unless initData is present and verifies against the bot's stored token.";
