process.env.SUPER_ADMIN_TELEGRAM_ID = "999";

const db: any = {
  matchUser: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  matchTransaction: { create: jest.fn() },
  randomChatSession: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  matchReport: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), count: jest.fn() },
  matchProfile: { findUnique: jest.fn(), count: jest.fn() },
  bot: { findUnique: jest.fn() },
  adminMessage: { count: jest.fn() },
  $transaction: jest.fn(),
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  $executeRawUnsafe: jest.fn(),
};
jest.mock("@/lib/prisma", () => ({ prisma: db }));
jest.mock("next/server", () => ({ after: (fn: () => unknown) => fn(), NextResponse: { json: (b: unknown) => b } }));
jest.mock("@/lib/match/realtime", () => ({ pingAnonSession: jest.fn(async () => undefined), anonSessionTopic: jest.fn(), realtimeConfig: () => null }));
jest.mock("@/lib/match/rateLimitPg", () => ({ pgRateLimit: jest.fn(async () => true) }));
jest.mock("@/lib/match/appStore", () => ({
  ...jest.requireActual("@/lib/match/appStore"),
  ensureMatchAppTables: async () => undefined,
  auditAdmin: jest.fn(async () => undefined),
  idleRandomSessions: jest.fn(async () => []),
  recordAnonMessage: jest.fn(async () => undefined),
}));
jest.mock("grammy", () => {
  class Kb { text() { return this; } row() { return this; } resized() { return this; } }
  return { Bot: class { api = { sendMessage: jest.fn(async () => ({})) }; constructor(public token: string) {} }, Keyboard: Kb, InlineKeyboard: Kb };
});

import { containsContactInfo, normalizeDigits } from "@/lib/match/contactGuard";
import { ensureMatchBotSetup, MATCH_BOT_COMMANDS } from "@/lib/matchBotLogic";

test("match bot setup: own /start command + global web_app menu, once per instance", async () => {
  const api = { deleteMyCommands: jest.fn(async () => true), setMyCommands: jest.fn(async () => true), setChatMenuButton: jest.fn(async () => true) };
  await ensureMatchBotSetup({ api } as any, "bot-1");
  await ensureMatchBotSetup({ api } as any, "bot-1");
  expect(api.setMyCommands).toHaveBeenCalledTimes(1);
  expect(api.setMyCommands).toHaveBeenCalledWith(MATCH_BOT_COMMANDS);
  expect(MATCH_BOT_COMMANDS.map((c) => c.command)).toEqual(["start"]);
  const menu = (api.setChatMenuButton.mock.calls[0] as any[])[0];
  expect(menu.chat_id).toBeUndefined();
  expect(menu.menu_button).toMatchObject({ type: "web_app", text: "التطبيق" });
  expect(menu.menu_button.web_app.url).toContain("bot-1");
  expect(api.deleteMyCommands).toHaveBeenCalled();
});
