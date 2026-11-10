// The daily chains bot's own Mini App (@Slaselbot, STREAK_BOT): auth per bot, check-ins once a day, khatma group rule,
// memorial Stars payload, and contest prizes only for the signed-in user.
import { NextRequest } from "next/server";
import { signInitData } from "@/lib/match/inline";

const TOKEN_S = "333:SSS-test-token-streak";
const TOKEN_A = "111:AAA-test-token-a";
const bots: Record<string, any> = {
  "bot-s": { id: "bot-s", token: TOKEN_S, isActive: true, template: "STREAK_BOT", ownerId: "900", requiredChannel: null },
  "bot-a": { id: "bot-a", token: TOKEN_A, isActive: true, template: "AD_BOT", ownerId: "900" },
};

// ---- in-memory streak entries for checkInCore
const entries = new Map<string, any>();
const earn = jest.fn(async () => null);
jest.mock("@/lib/platformPoints", () => ({ earnPoints: (...a: any[]) => (earn as any)(...a) }));
jest.mock("@/lib/prisma", () => ({
  prisma: {
    bot: { findUnique: jest.fn(async ({ where }: any) => bots[where.id] || null) },
    streakUser: {
      upsert: jest.fn(async ({ create }: any) => ({ id: create?.id, isBanned: false, mutedUntil: null })),
      findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, isBanned: false, mutedUntil: null })),
      update: jest.fn(async () => ({})),
    },
    streakEntry: {
      upsert: jest.fn(async ({ where }: any) => {
        const k = `${where.userId_category.userId}:${where.userId_category.category}`;
        if (!entries.has(k)) entries.set(k, { userId: where.userId_category.userId, category: where.userId_category.category, currentStreak: 0, longestStreak: 0, lastCheckInDate: null });
        return { ...entries.get(k) };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const k = `${where.userId}:${where.category}`;
        const e = entries.get(k);
        if (!e || e.lastCheckInDate !== where.lastCheckInDate) return { count: 0 };
        Object.assign(e, data);
        return { count: 1 };
      }),
      findMany: jest.fn(async ({ where }: any) => [...entries.values()].filter((e) => e.userId === where.userId)),
    },
    $queryRaw: jest.fn(async () => []),
    $executeRaw: jest.fn(async () => 0),
  },
}));

// ---- Telegram API
const api = {
  getMe: jest.fn(async () => ({ username: "Slaselbot" })),
  getChatMember: jest.fn(async () => ({ status: "left" })),
  createInvoiceLink: jest.fn(async () => "https://t.me/$inv"),
  sendMessage: jest.fn(async () => ({})),
};
jest.mock("grammy", () => {
  const actual = jest.requireActual("grammy");
  return { ...actual, Bot: jest.fn().mockImplementation(() => ({ api })) };
});

// ---- khatma / contests
const tapJuzCore = jest.fn(async () => ({ ok: true, message: "تم" }));
const refreshGroupBoard = jest.fn(async () => null);
const khatmaForApp = jest.fn();
const createMemorialOrderCore = jest.fn(async () => ({ ok: true, orderId: "77", stars: 100, title: "ختمة", tierLabel: "عادية", payload: "KHATMA:77" }));
const paySponsor = jest.fn(async () => ({ ok: true, amount: 5.0123, usdt: "TADDR", network: "TRC20", expiresInMin: 60, note: "n" }));
jest.mock("@/lib/khatma/khatma", () => {
  const actual = jest.requireActual("@/lib/khatma/khatma");
  return {
    ...actual,
    tapJuzCore: (...a: any[]) => (tapJuzCore as any)(...a),
    refreshGroupBoard: (...a: any[]) => (refreshGroupBoard as any)(...a),
    khatmaForApp: (...a: any[]) => (khatmaForApp as any)(...a),
    createMemorialOrderCore: (...a: any[]) => (createMemorialOrderCore as any)(...a),
    paySponsor: (...a: any[]) => (paySponsor as any)(...a),
  };
});
const claimPrizes = jest.fn(async () => 1);
jest.mock("@/lib/contests/prizes", () => {
  const actual = jest.requireActual("@/lib/contests/prizes");
  return { ...actual, claimPrizes: (...a: any[]) => (claimPrizes as any)(...a), ensurePrizeTables: jest.fn(async () => null) };
});
const adHandle = jest.fn(async () => ({ ok: true, app: "ad" }));
jest.mock("@/lib/botApp/adApp", () => ({ handleAdAppAction: (...a: any[]) => (adHandle as any)(...a) }));

import { POST } from "@/app/api/bot-app/[botId]/route";
import { checkInCore, todayKey, yesterdayKey } from "@/lib/streakBotLogic";
import { handleStreakAppAction } from "@/lib/botApp/streakApp";

const initFor = (token: string, id = 4242) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000) - 30), query_id: "q1", user: JSON.stringify({ id, first_name: "Sam", username: "sam" }) }, token);
const call = (botId: string, body: any) =>
  POST(new NextRequest(`https://x.test/api/bot-app/${botId}`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } }), { params: Promise.resolve({ botId }) });
const tg: any = { id: "4242", firstName: "Sam", username: "sam" };

beforeEach(() => {
  entries.clear();
  jest.clearAllMocks();
});

describe("chains bot Mini App auth", () => {
  it("a STREAK_BOT gets its own app, signed with ITS token; the user id comes from Telegram", async () => {
    const res = await call("bot-s", { initData: initFor(TOKEN_S, 4242), action: "init", userId: "999" });
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(j.user.id).toBe("4242");
    expect(j.streaks).toHaveLength(4);
    expect(adHandle).not.toHaveBeenCalled();
  });
  it("initData from another bot's token is refused", async () => {
    const res = await call("bot-s", { initData: initFor(TOKEN_A), action: "init" });
    expect(res.status).toBe(401);
  });
});

describe("check-in (same rule as the chat)", () => {
  it("first check-in starts at 1 and awards a point; a second one today does nothing", async () => {
    const a = await checkInCore("bot-s", "u1", "prayer");
    expect(a).toMatchObject({ already: false, continued: false, entry: { currentStreak: 1, longestStreak: 1, lastCheckInDate: todayKey() } });
    const b = await checkInCore("bot-s", "u1", "prayer");
    expect(b.already).toBe(true);
    expect(earn).toHaveBeenCalledTimes(1);
  });
  it("yesterday continues the streak, a gap restarts it at 1 (longest kept)", async () => {
    entries.set("u2:reading", { userId: "u2", category: "reading", currentStreak: 4, longestStreak: 9, lastCheckInDate: yesterdayKey() });
    expect((await checkInCore("bot-s", "u2", "reading")).entry).toMatchObject({ currentStreak: 5, longestStreak: 9 });
    entries.set("u3:reading", { userId: "u3", category: "reading", currentStreak: 4, longestStreak: 4, lastCheckInDate: "2000-01-01" });
    expect((await checkInCore("bot-s", "u3", "reading")).entry).toMatchObject({ currentStreak: 1, longestStreak: 4 });
  });
  it("a double tap at once (chat + app) counts one day only", async () => {
    const [x, y] = await Promise.all([checkInCore("bot-s", "u4", "fasting"), checkInCore("bot-s", "u4", "fasting")]);
    expect([x.already, y.already].filter((v) => !v)).toHaveLength(1);
    expect(entries.get("u4:fasting").currentStreak).toBe(1);
    expect(earn).toHaveBeenCalledTimes(1);
  });
  it("the app's check_in rejects unknown categories", async () => {
    expect((await handleStreakAppAction(bots["bot-s"], tg, "check_in", { category: "nope" })).ok).toBe(false);
    const r: any = await handleStreakAppAction(bots["bot-s"], tg, "check_in", { category: "exercise" });
    expect(r).toMatchObject({ ok: true, already: false, current: 1 });
  });
});

describe("khatma from the app", () => {
  const group = { id: "1", kind: "GROUP", chat_id: "-100", round: 2, bot_id: "bot-s" };
  it("a GROUP board is only for members of that group", async () => {
    khatmaForApp.mockResolvedValue(group);
    api.getChatMember.mockResolvedValueOnce({ status: "left" });
    const r: any = await handleStreakAppAction(bots["bot-s"], tg, "kh_tap", { id: "1", round: 2, juz: 3 });
    expect(r).toMatchObject({ ok: false, code: "not_member" });
    expect(tapJuzCore).not.toHaveBeenCalled();
    api.getChatMember.mockResolvedValueOnce({ status: "member" });
    const ok: any = await handleStreakAppAction(bots["bot-s"], tg, "kh_tap", { id: "1", round: 2, juz: 3 });
    expect(ok.ok).toBe(true);
    expect((tapJuzCore.mock.calls[0] as any[]).slice(2, 4)).toEqual([3, "4242"]);
    expect(refreshGroupBoard).toHaveBeenCalled();
  });
  it("a stale round or a bad juz number is refused", async () => {
    khatmaForApp.mockResolvedValue({ ...group, kind: "MEMORIAL" });
    expect(await handleStreakAppAction(bots["bot-s"], tg, "kh_tap", { id: "1", round: 1, juz: 3 })).toMatchObject({ ok: false, code: "round" });
    expect((await handleStreakAppAction(bots["bot-s"], tg, "kh_tap", { id: "1", round: 2, juz: 31 })).ok).toBe(false);
    expect(tapJuzCore).not.toHaveBeenCalled();
  });
  it("a memorial order is paid in Stars to this bot with the chat's KHATMA:<order> payload", async () => {
    const r: any = await handleStreakAppAction(bots["bot-s"], tg, "kh_memorial", { name: "محمد", intent: "rahma", tier: "basic" });
    expect(r).toMatchObject({ ok: true, link: "https://t.me/$inv", stars: 100 });
    expect((createMemorialOrderCore.mock.calls[0] as any[])[1]).toBe("4242");
    const [, , payload, provider, currency, prices] = api.createInvoiceLink.mock.calls[0] as any[];
    expect([payload, provider, currency, prices[0].amount]).toEqual(["KHATMA:77", "", "XTR", 100]);
  });
});

describe("contest prizes from the app", () => {
  it("claim hands over only the signed-in user's prizes, into their own chat", async () => {
    const r = await handleStreakAppAction(bots["bot-s"], tg, "ct_claim", { userId: "1", chatId: -5 });
    expect(r.ok).toBe(true);
    expect(claimPrizes).toHaveBeenCalledTimes(1);
    expect((claimPrizes.mock.calls[0] as any[]).slice(1)).toEqual([4242, "4242"]);
  });
  it("USDT sponsorship returns the exact amount and address from paySponsor", async () => {
    const r: any = await handleStreakAppAction(bots["bot-s"], tg, "ct_pay", { code: "abc123", method: "usdt" });
    expect(paySponsor).toHaveBeenCalledWith("ABC123", "usdt");
    expect(r).toMatchObject({ ok: true, manual: true, amount: 5.0123, address: "TADDR", network: "TRC20" });
  });
  it("an unknown payment method falls back to Stars; unknown actions are refused", async () => {
    paySponsor.mockResolvedValueOnce({ ok: true, invoiceUrl: "https://t.me/$s" } as any);
    expect(await handleStreakAppAction(bots["bot-s"], tg, "ct_pay", { code: "X", method: "card" })).toMatchObject({ ok: true, url: "https://t.me/$s" });
    expect(paySponsor).toHaveBeenLastCalledWith("X", "stars");
    expect((await handleStreakAppAction(bots["bot-s"], tg, "drop_tables", {})).ok).toBe(false);
  });
});
