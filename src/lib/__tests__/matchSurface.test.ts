const db: any = {
  matchUser: { findUnique: jest.fn(), update: jest.fn() },
  randomChatSession: { findUnique: jest.fn(), update: jest.fn() },
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(),
  $executeRawUnsafe: jest.fn(),
};
jest.mock("@/lib/prisma", () => ({ prisma: db }));
const afterFns: (() => unknown)[] = [];
jest.mock("next/server", () => ({ after: (fn: () => unknown) => { afterFns.push(fn); }, NextResponse: { json: (b: unknown) => b } }));
jest.mock("@/lib/match/realtime", () => ({ pingAnonSession: jest.fn(async () => undefined), anonSessionTopic: jest.fn(), realtimeConfig: () => null }));
jest.mock("@/lib/match/rateLimitPg", () => ({ pgRateLimit: jest.fn(async () => true) }));
jest.mock("grammy", () => {
  class Kb { text() { return this; } row() { return this; } resized() { return this; } }
  return { Bot: class { api = { sendMessage: jest.fn(async () => ({})) }; constructor(public token: string) {} }, Keyboard: Kb, InlineKeyboard: Kb };
});

import { APP_ACTIVE_WINDOW_MS, deliverToUser, shouldNotifyTelegram } from "@/lib/match/surface";
import { relayRandomChatText } from "@/lib/matchBotLogic";
import { anonPoll, anonSend } from "@/lib/match/anon";

let lastSeen: Record<string, Date | undefined> = {};
let history: any[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  afterFns.length = 0;
  lastSeen = {}; history = [];
  db.$queryRaw.mockImplementation(async (strs: string[], ...vals: any[]) => {
    const q = strs.join("?");
    if (q.includes("match_app_schema")) return [{ version: 999 }];
    if (q.includes("match_app_presence")) return lastSeen[vals[0]] ? [{ last_seen: lastSeen[vals[0]] }] : [];
    if (q.includes("FROM match_app_messages")) return history.filter((m) => m.session_id === vals[0]).map((m, i) => ({ id: BigInt(i + 1), ...m }));
    return [];
  });
  db.$executeRaw.mockImplementation(async (strs: string[], ...vals: any[]) => {
    const q = strs.join("?");
    if (q.includes("INSERT INTO match_app_presence")) lastSeen[vals[0]] = new Date();
    if (q.includes("INSERT INTO match_app_messages")) history.push({ session_id: vals[0], sender_id: vals[1], text: vals[2], created_at: new Date() });
    return 1;
  });
});
const fakeBot = () => ({ api: { sendMessage: jest.fn(async () => ({})) } }) as any;

describe("routing rule", () => {
  it("Telegram only when the app was not seen in the last 30s", () => {
    const now = Date.now();
    expect(shouldNotifyTelegram(null, now)).toBe(true);
    expect(shouldNotifyTelegram(new Date(now - 5_000), now)).toBe(false);
    expect(shouldNotifyTelegram(new Date(now - APP_ACTIVE_WINDOW_MS - 1), now)).toBe(true);
  });
  it("deliverToUser skips Telegram for an app-active user and sends for a bot user", async () => {
    lastSeen["1"] = new Date();
    const bot = fakeBot();
    expect(await deliverToUser(bot, "1", "hi")).toBe("app");
    expect(await deliverToUser(bot, "2", "hi")).toBe("telegram");
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
    expect(bot.api.sendMessage.mock.calls[0][0]).toBe(2);
  });
});

describe("relay between app and bot users (same session, same rules)", () => {
  it("bot → app user: recorded for the app, no Telegram duplicate", async () => {
    lastSeen["20"] = new Date(); // partner is in the app
    db.randomChatSession.update.mockResolvedValue({ messageCount: 1, contactOfferSent: false });
    const bot = fakeBot();
    expect(await relayRandomChatText(bot, 10, "10", { sessionId: "s1", partnerId: "20" }, "مرحبا")).toBe("sent");
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
    expect(history).toEqual([expect.objectContaining({ session_id: "s1", sender_id: "10", text: "مرحبا" })]);
  });
  it("app → bot user: delivered to Telegram as before", async () => {
    db.randomChatSession.update.mockResolvedValue({ messageCount: 1, contactOfferSent: false });
    const bot = fakeBot();
    await relayRandomChatText(bot, 20, "20", { sessionId: "s1", partnerId: "10" }, "أهلاً");
    expect(bot.api.sendMessage).toHaveBeenCalledWith(10, "أهلاً", undefined);
  });
});

describe("app renders the chat itself (no 'continue in the bot')", () => {
  it("a fake-partner chat is returned as an in-app chat with history", async () => {
    db.matchUser.findUnique.mockResolvedValue({ pendingAction: { mode: "fake_chatting", fakeBotId: 0, step: 0, lastAt: Date.now() } });
    history.push({ session_id: "fake:7", sender_id: "partner", text: "السلام عليكم", created_at: new Date() });
    const r: any = await anonPoll("7", 0);
    expect(r.state).toBe("chatting");
    expect(r.fake).toBe(true);
    expect(r.messages).toEqual([expect.objectContaining({ mine: false, text: "السلام عليكم" })]);
    expect(lastSeen["7"]).toBeDefined(); // polling marks the app as the active surface
  });
  it("sending in a fake chat records the user's message and runs the bot script after the response", async () => {
    db.matchUser.findUnique.mockResolvedValue({ pendingAction: { mode: "fake_chatting", fakeBotId: 0, step: 0, lastAt: Date.now() } });
    const r = await anonSend(fakeBot(), "7", "وعليكم السلام");
    expect(r.ok).toBe(true);
    expect(history.some((m) => m.session_id === "fake:7" && m.sender_id === "7")).toBe(true);
    expect(afterFns.length).toBe(1);
  });
  it("a real chat is rendered in-app with mine/partner flags only (no partner id)", async () => {
    db.matchUser.findUnique.mockResolvedValue({ pendingAction: { mode: "random_chatting", sessionId: "s9", partnerId: "20" } });
    db.randomChatSession.findUnique.mockResolvedValue({ status: "ACTIVE", contactOfferSent: false, contactRequestedBy: null });
    history.push({ session_id: "s9", sender_id: "20", text: "hi", created_at: new Date() }, { session_id: "s9", sender_id: "7", text: "yo", created_at: new Date() });
    const r: any = await anonPoll("7", 0);
    expect(r.messages.map((m: any) => m.mine)).toEqual([false, true]);
    expect(JSON.stringify(r)).not.toContain('"20"');
  });
});
