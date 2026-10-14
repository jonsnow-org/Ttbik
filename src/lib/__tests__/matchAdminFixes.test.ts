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
import { chargeMatchUser } from "@/lib/match/entitlements";
import { pgRateLimit } from "@/lib/match/rateLimitPg";
import * as appStore from "@/lib/match/appStore";
import { decideProfileByUserId, fileMatchReport, isMatchAdmin, requestRandomChatContact, resolveMatchReport, sweepIdleRandomSessions } from "@/lib/matchBotLogic";
import { handleAdminAction } from "@/lib/match/adminApp";

const fakeBot = () => ({ api: { sendMessage: jest.fn(async () => ({})) } }) as any;
let rawQueue: unknown[] = [];
beforeEach(() => {
  jest.clearAllMocks();
  (pgRateLimit as jest.Mock).mockResolvedValue(true);
  db.matchReport.create.mockResolvedValue({});
  rawQueue = [];
  // Schema run-once flag answers "up to date"; other raw queries pop from rawQueue.
  db.$queryRaw.mockImplementation(async (strs: string[]) => (strs.join("").includes("match_app_schema") ? [{ version: 999 }] : rawQueue.shift() ?? []));
});

describe("contact guard (bot + app anon chat)", () => {
  it.each([
    "0501234567", "05 01 23 45 67", "+966-50-123-4567", "٠٥٠١٢٣٤٥٦٧", "۰۵۰۱۲۳۴۵۶۷", "0 5 0 1 2 3 4 5 6 7",
    "كلمني @someone_here", "t.me/someone", "T . ME / x", "wa.me/9665", "https://x.com", "www.site.net",
    "mail me ali@gmail.com", "ali (at) gmail (dot) com", "zzz.com",
  ])("blocks %s", (t) => expect(containsContactInfo(t)).toBe(true));
  it.each(["السلام عليكم", "عمري 25 وأنا من مصر", "عندي 3 إخوة و2 أخوات", "سنة 2024", "@ab"])("allows %s", (t) => expect(containsContactInfo(t)).toBe(false));
  it("normalizes Eastern digits", () => expect(normalizeDigits("٠١٢۳۴")).toBe("01234"));
});

describe("atomic balance charge", () => {
  const tx = { matchUser: { updateMany: jest.fn() }, matchTransaction: { create: jest.fn(), count: jest.fn(async () => 1) }, $executeRaw: jest.fn(async () => 1), $queryRaw: jest.fn(async () => []) };
  beforeEach(() => { db.$transaction.mockImplementation(async (fn: any) => fn(tx)); tx.matchTransaction.count.mockResolvedValue(1); });
  it("charges with a conditional update and writes the ledger", async () => {
    tx.matchUser.updateMany.mockResolvedValueOnce({ count: 1 });
    db.matchUser.findUnique.mockResolvedValueOnce({ balance: 3 });
    const r = await chargeMatchUser("1", 2, "BOOST");
    expect(tx.matchUser.updateMany).toHaveBeenCalledWith({ where: { id: "1", balance: { gte: 2 } }, data: { balance: { decrement: 2 } } });
    expect(tx.matchTransaction.create).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ ok: true, balance: 3, charged: 2, discounted: false });
  });
  it("charges nothing when the conditional update hits 0 rows (double tap / low balance)", async () => {
    tx.matchUser.updateMany.mockResolvedValueOnce({ count: 0 });
    db.matchUser.findUnique.mockResolvedValueOnce({ balance: 1 });
    const r = await chargeMatchUser("1", 2, "BOOST");
    expect(tx.matchTransaction.create).not.toHaveBeenCalled();
    expect(r.ok).toBe(false);
  });
  it("first upgrade purchase gets 20% off once (claimed in the same transaction)", async () => {
    tx.matchTransaction.count.mockResolvedValueOnce(0);
    tx.$queryRaw.mockResolvedValueOnce([]);
    tx.$executeRaw.mockResolvedValueOnce(1);
    tx.matchUser.updateMany.mockResolvedValueOnce({ count: 1 });
    db.matchUser.findUnique.mockResolvedValueOnce({ balance: 0.4 });
    const r = await chargeMatchUser("1", 2, "BOOST");
    expect(tx.matchUser.updateMany).toHaveBeenCalledWith({ where: { id: "1", balance: { gte: 1.6 } }, data: { balance: { decrement: 1.6 } } });
    expect(tx.matchTransaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ amount: 1.6, type: "BOOST_FIRST20" }) });
    expect(r).toMatchObject({ ok: true, charged: 1.6, discounted: true });
  });
  it("a failed discounted charge rolls the claim back (throws inside the tx) and charges nothing", async () => {
    tx.matchTransaction.count.mockResolvedValueOnce(0);
    tx.$queryRaw.mockResolvedValueOnce([]);
    tx.$executeRaw.mockResolvedValueOnce(1);
    tx.matchUser.updateMany.mockResolvedValueOnce({ count: 0 });
    db.matchUser.findUnique.mockResolvedValueOnce({ balance: 0 });
    const r = await chargeMatchUser("1", 2, "BOOST");
    expect(r).toMatchObject({ ok: false, discounted: false });
    expect(tx.matchTransaction.create).not.toHaveBeenCalled();
  });
  it("per-use items (super like) never use the first-purchase discount", async () => {
    tx.matchTransaction.count.mockResolvedValueOnce(0);
    tx.matchUser.updateMany.mockResolvedValueOnce({ count: 1 });
    db.matchUser.findUnique.mockResolvedValueOnce({ balance: 5 });
    await chargeMatchUser("1", 1, "SUPER_LIKE");
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.matchUser.updateMany).toHaveBeenCalledWith({ where: { id: "1", balance: { gte: 1 } }, data: { balance: { decrement: 1 } } });
  });
  it("is rate limited across instances", async () => {
    (pgRateLimit as jest.Mock).mockResolvedValueOnce(false);
    db.matchUser.findUnique.mockResolvedValueOnce({ balance: 9 });
    expect((await chargeMatchUser("1", 2, "X")).ok).toBe(false);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});

describe("atomic anon-filter extension", () => {
  it("uses GREATEST(..., now()) + interval in one statement", async () => {
    rawQueue.push([{ paid_until: new Date("2026-11-13") }]);
    await appStore.extendAnonPaidUntilAtomic("1", 30);
    const sql = db.$queryRaw.mock.calls.map((c: any[]) => (c[0] as string[]).join("?")).find((q: string) => q.includes("match_anon_filters"));
    expect(sql).toMatch(/GREATEST\(COALESCE\(match_anon_filters\.paid_until, now\(\)\), now\(\)\) \+ make_interval/);
  });
});

describe("atomic contact-exchange request", () => {
  const pending = { sessionId: "s", partnerId: "2" };
  it("first tap claims the request", async () => {
    db.randomChatSession.findUnique.mockResolvedValueOnce({ id: "s", status: "ACTIVE", contactOfferSent: true, contactRequestedBy: null });
    db.randomChatSession.updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await requestRandomChatContact(fakeBot(), "1", pending)).toBe("requested");
    expect(db.randomChatSession.updateMany).toHaveBeenCalledWith({ where: { id: "s", contactRequestedBy: null }, data: { contactRequestedBy: "1" } });
  });
  it("simultaneous tap: the loser reveals instead of hanging", async () => {
    db.randomChatSession.findUnique
      .mockResolvedValueOnce({ id: "s", status: "ACTIVE", contactOfferSent: true, contactRequestedBy: null })
      .mockResolvedValueOnce({ contactRequestedBy: "2" });
    db.randomChatSession.updateMany.mockResolvedValueOnce({ count: 0 });
    db.matchProfile.findUnique.mockResolvedValue(null);
    expect(await requestRandomChatContact(fakeBot(), "1", pending)).toBe("revealed");
  });
  it("not before the 15-message offer", async () => {
    db.randomChatSession.findUnique.mockResolvedValueOnce({ id: "s", status: "ACTIVE", contactOfferSent: false });
    expect(await requestRandomChatContact(fakeBot(), "1", pending)).toBe("not_offered");
  });
});

describe("reports: rate limit + auto-mute after 3 distinct reporters", () => {
  it("mutes and notifies the admin at 3 distinct reporters", async () => {
    db.matchReport.findMany.mockResolvedValueOnce([{ reporterId: "a" }, { reporterId: "b" }, { reporterId: "c" }]);
    db.matchUser.updateMany.mockResolvedValueOnce({ count: 1 });
    const bot = fakeBot();
    expect(await fileMatchReport(bot, "c", "7", "RANDOM_CHAT", "alert")).toBe("ok");
    expect(db.matchUser.updateMany).toHaveBeenCalled();
    const texts = bot.api.sendMessage.mock.calls.map((c: any[]) => c[1]);
    expect(texts[0]).toBe("alert"); // bot's existing alert unchanged
    expect(texts.some((t: string) => t.includes("كتم تلقائي"))).toBe(true);
  });
  it("does not mute with 2 distinct reporters", async () => {
    db.matchReport.findMany.mockResolvedValueOnce([{ reporterId: "a" }, { reporterId: "b" }]);
    await fileMatchReport(fakeBot(), "b", "7", "SEARCH", "alert");
    expect(db.matchUser.updateMany).not.toHaveBeenCalled();
  });
  it("is rate limited", async () => {
    (pgRateLimit as jest.Mock).mockResolvedValueOnce(false);
    expect(await fileMatchReport(fakeBot(), "a", "7", "SEARCH", "x")).toBe("limited");
    expect(db.matchReport.create).not.toHaveBeenCalled();
  });
  it("report resolution is claimed atomically", async () => {
    db.matchReport.findUnique.mockResolvedValueOnce({ id: "r", targetId: "7", source: "SEARCH" });
    db.matchReport.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await resolveMatchReport(fakeBot(), 999, "r", "ban")).toBe("already");
    expect(db.matchUser.update).not.toHaveBeenCalled();
  });
});

describe("idle anon sessions", () => {
  it("ends sessions idle 30 min and tells both sides", async () => {
    (appStore.idleRandomSessions as jest.Mock).mockResolvedValueOnce([{ id: "s", user1Id: "1", user2Id: "2", botId: "b" }]);
    db.randomChatSession.updateMany.mockResolvedValueOnce({ count: 1 });
    db.bot.findUnique.mockResolvedValueOnce({ token: "t" });
    db.matchUser.findUnique.mockResolvedValue({ pendingAction: { mode: "random_chatting", sessionId: "s" } });
    db.matchUser.update.mockResolvedValue({});
    expect(await sweepIdleRandomSessions()).toBe(1);
    expect(appStore.idleRandomSessions).toHaveBeenCalledWith(30);
  });
});

describe("admin gating (server-side, bot's exact check)", () => {
  it("isMatchAdmin matches only SUPER_ADMIN", () => {
    expect(isMatchAdmin("999")).toBe(true);
    expect(isMatchAdmin("998")).toBe(false);
    expect(isMatchAdmin("")).toBe(false);
    expect(isMatchAdmin(undefined)).toBe(false);
  });
  it.each(["admin_overview", "admin_broadcast", "admin_unban", "admin_report_resolve", "admin_profile_decide"])("rejects non-admin for %s without touching the DB", async (a) => {
    const r = await handleAdminAction(fakeBot(), { id: "b" } as any, "123", a, { text: "x", userId: "5" });
    expect(r.status).toBe(403);
    expect(db.matchProfile.count).not.toHaveBeenCalled();
    expect(db.matchUser.update).not.toHaveBeenCalled();
  });
  it("lets the admin through", async () => {
    db.matchProfile.count.mockResolvedValue(0); db.matchReport.count.mockResolvedValue(0); db.adminMessage.count.mockResolvedValue(0);
    const r = await handleAdminAction(fakeBot(), { id: "b" } as any, "999", "admin_audit", {});
    expect(r.status).toBe(200);
  });
});


describe("admin ✅ on an edited (already APPROVED) profile", () => {
  it("confirms instead of replying «غير موجود»", async () => {
    db.matchProfile.findUnique.mockResolvedValueOnce({ userId: "367969", name: "سامي", status: "APPROVED", isHidden: false });
    const bot = fakeBot();
    await decideProfileByUserId(bot, 999, "367969", true);
    const txt = bot.api.sendMessage.mock.calls.map((c: any[]) => c[1]).join("|");
    expect(txt).toContain("تم تأكيد ملف سامي");
    expect(txt).not.toContain("غير موجود");
  });
  it("still reports a truly missing profile", async () => {
    db.matchProfile.findUnique.mockResolvedValueOnce(null);
    const bot = fakeBot();
    await decideProfileByUserId(bot, 999, "1", true);
    expect(bot.api.sendMessage.mock.calls[0][1]).toContain("غير موجود");
  });
});
