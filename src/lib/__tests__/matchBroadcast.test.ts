process.env.SUPER_ADMIN_TELEGRAM_ID = "999";

const db: any = {
  matchUser: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn() },
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
import { runBroadcast } from "@/lib/matchBotLogic";
import { pgRateLimit } from "@/lib/match/rateLimitPg";

test("broadcast is scoped to this bot, skips failures, reports the count", async () => {
  db.matchUser.findMany.mockResolvedValue([{ id: "1" }, { id: "2" }]);
  const send = jest.fn(async (id: number) => { if (id === 2) throw new Error("blocked"); return {}; });
  await runBroadcast({ api: { sendMessage: send } } as any, 999, "مرحبا", "bot-A");
  expect(db.matchUser.findMany.mock.calls[0][0].where.botId).toBe("bot-A");
  expect(send).toHaveBeenLastCalledWith(999, expect.stringContaining("1 من أصل 2"), expect.anything());
});
test("double-send guard: a second broadcast within a minute is refused", async () => {
  (pgRateLimit as jest.Mock).mockResolvedValueOnce(false);
  db.matchUser.findMany.mockClear();
  const send = jest.fn(async () => ({}));
  await runBroadcast({ api: { sendMessage: send } } as any, 999, "x", "bot-A");
  expect(db.matchUser.findMany).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(1);
});
