// Phase 4 audit (MARRIAGE_BOT): moderation, Stars pre-checkout, search and matchmaker scoring rules, and the
// matchmaker note step in the bot. Written to fail on the old code first.
process.env.SUPER_ADMIN_TELEGRAM_ID = "999";

const captured: any = { where: null };
const db: any = {
  matchUser: {
    upsert: jest.fn(async () => u()), findUnique: jest.fn(async () => u()), update: jest.fn(async () => ({})), create: jest.fn(async () => u()),
  },
  matchProfile: {
    findUnique: jest.fn(async () => ({ id: "00000000-0000-4000-8000-000000000001", userId: "123", gender: "MALE", status: "APPROVED", user: { botId: "b1", isBanned: false } })),
    count: jest.fn(async ({ where }: any) => { captured.where = where; return 0; }),
    findMany: jest.fn(async () => []),
  },
  matchBlock: { findMany: jest.fn(async () => []) },
  matchProfileVisit: { findMany: jest.fn(async () => []), groupBy: jest.fn(async () => []) },
  matchProfilePrivacy: { findMany: jest.fn(async () => []) },
  matchLike: { findMany: jest.fn(async () => []) },
  partnerPreference: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
  $queryRaw: jest.fn(async () => []),
  $executeRaw: jest.fn(async () => 1),
  $executeRawUnsafe: jest.fn(async () => 0),
  $transaction: jest.fn(async (fn: any) => fn(db)),
};
let pending: any = null;
function u() { return { id: "123", botId: "b1", phoneVerified: true, pendingAction: pending, isBanned: false, balance: 0, lastActiveAt: new Date() }; }
jest.mock("@/lib/prisma", () => ({ prisma: db }));
jest.mock("@/lib/match/rateLimitPg", () => ({ pgRateLimit: jest.fn(async () => true) }));
jest.mock("@/lib/match/growth", () => ({ ...jest.requireActual("@/lib/match/growth"), trackFunnel: jest.fn(async () => undefined) }));

import { nextProfileStatus, matchPreCheckout, MATCH_PAYER_MISMATCH_TEXT, MATCH_UNKNOWN_INVOICE_TEXT } from "@/lib/match/guardRules";
import { affinityFactor, emptyCandidatesText, rankMatchmakerScored, reciprocalFit } from "@/lib/match/trustRules";
import { MAIN_MENU_LABELS, buildSearchQueue, handleMarriageBotUpdate } from "@/lib/matchBotLogic";
import * as trust from "@/lib/match/trust";

describe("moderation: a rejected profile cannot be published by saving twice", () => {
  it("new and approved profiles go live at once (owner decision 2026-10-11)", () => {
    expect(nextProfileStatus(undefined)).toBe("APPROVED");
    expect(nextProfileStatus("APPROVED")).toBe("APPROVED");
  });
  it("rejected goes to review, and a profile still in review stays in review", () => {
    expect(nextProfileStatus("REJECTED")).toBe("PENDING");
    // old rule: PENDING → APPROVED, i.e. the second save after a rejection skipped the review
    expect(nextProfileStatus("PENDING")).toBe("PENDING");
  });
});

describe("Stars pre-checkout (MARRIAGE_BOT)", () => {
  it("approves the bot's own invoices paid by the user they were made for", () => {
    expect(matchPreCheckout("MATCH_DEPOSIT:123", 123)).toEqual({ ok: true });
    expect(matchPreCheckout("MATCH_MM:123", "123")).toEqual({ ok: true });
    expect(matchPreCheckout("MATCH_BUY_vip:123", 123)).toEqual({ ok: true });
    expect(matchPreCheckout("MATCH_BUY_vipTrial:123", 123)).toEqual({ ok: true });
  });
  it("rejects an invoice paid by someone else (it used to be approved and then credited to nobody)", () => {
    expect(matchPreCheckout("MATCH_DEPOSIT:123", 456)).toEqual({ ok: false, message: MATCH_PAYER_MISMATCH_TEXT });
    expect(matchPreCheckout("MATCH_BUY_boost:123", 456)).toEqual({ ok: false, message: MATCH_PAYER_MISMATCH_TEXT });
  });
  it("rejects unknown kinds and garbage", () => {
    expect(matchPreCheckout("MATCH_BUY_free:123", 123)).toEqual({ ok: false, message: MATCH_UNKNOWN_INVOICE_TEXT });
    expect(matchPreCheckout("ADBOT_DEPOSIT:123", 123)).toEqual({ ok: false, message: MATCH_UNKNOWN_INVOICE_TEXT });
    expect(matchPreCheckout("", 123)).toEqual({ ok: false, message: MATCH_UNKNOWN_INVOICE_TEXT });
  });
});

describe("search: banned members are never dealt", () => {
  it("buildSearchQueue asks only for profiles of members who are not banned", async () => {
    await buildSearchQueue("b1", "123", { gender: "MALE", country: "الأردن", age: 30 } as any, { country: "الأردن" } as any);
    expect(captured.where.user).toEqual({ botId: "b1", isBanned: false });
  });
});

describe("matching rules", () => {
  it("reciprocalFit: the requester meets the candidate's own wishes", () => {
    expect(reciprocalFit({ age: 30, country: "الأردن" }, { country: "الاردن", ageMin: 28, ageMax: 35 })).toBe("fit");
    expect(reciprocalFit({ age: 40, country: "الأردن" }, { ageMin: 25, ageMax: 32 })).toBe("miss");
    expect(reciprocalFit({ age: 30, country: "مصر" }, { country: "الأردن" })).toBe("miss");
    expect(reciprocalFit({ age: 30 }, null)).toBe("unknown");
    expect(reciprocalFit({ age: 34, country: "الأردن" }, { ageMax: 32 })).toBe("fit"); // within 3 years is not a clear miss
  });
  it("affinityFactor: never zero (owner rule: weigh, don't eliminate)", () => {
    expect(affinityFactor({})).toBe(1);
    expect(affinityFactor({ likedByMe: true })).toBeGreaterThan(0);
    expect(affinityFactor({ likedByMe: true })).toBeLessThan(1);
    expect(affinityFactor({ likedMe: true, fit: "fit" })).toBeGreaterThan(affinityFactor({ likedMe: true }));
    expect(affinityFactor({ fit: "miss" })).toBeLessThan(1);
  });
  it("matchmaker score uses job/education wishes and the requester's own country when no country wish is set", () => {
    const now = new Date();
    const base = { gender: "FEMALE", age: 27, lastActiveAt: now };
    const list = [
      { ...base, id: "a", userId: "a", country: "مصر" },
      { ...base, id: "b", userId: "b", country: "الأردن", job: "مهندسة برمجيات" },
      { ...base, id: "c", userId: "c", country: "الأردن" },
    ];
    const r = rankMatchmakerScored({ userId: "me", gender: "MALE", country: "الأردن", pref: { job: "مهندسة" } }, list, now);
    expect(r.map((x) => x.c.id)).toEqual(["b", "c", "a"]);
    expect(r[0].why).toEqual(expect.arrayContaining(["نفس الدولة", "العمل"]));
  });
  it("a profile the requester skipped is ranked lower, not removed", () => {
    const now = new Date();
    const base = { gender: "FEMALE", age: 27, country: "الأردن", lastActiveAt: now };
    const r = rankMatchmakerScored({ userId: "me", gender: "MALE" }, [{ ...base, id: "s", userId: "s", passedByRequester: true }, { ...base, id: "n", userId: "n" }], now);
    expect(r.map((x) => x.c.id)).toEqual(["n", "s"]);
  });
  it("the admin's empty state says why and what to do", () => {
    const t = emptyCandidatesText("7", { pool: 12, sent: 3, liked: 2, hidden: 1 });
    expect(t).toContain("#7");
    expect(t).toContain("فُحص 12");
    expect(t).toContain("3 أُرسلت له من قبل");
    expect(t).toContain("↩️ استرداد");
    expect(emptyCandidatesText("8", { pool: 0, sent: 0, liked: 0, hidden: 0 })).toContain("لا توجد ملفات معتمدة ظاهرة");
  });
});

describe("matchmaker note step in the bot", () => {
  const row = { id: "b1", token: "t", ownerId: "999" } as any;
  const mkBot = () => ({ api: { sendMessage: jest.fn(async () => ({ message_id: 1 })), answerCallbackQuery: jest.fn(async () => true), setMyCommands: jest.fn(async () => true), deleteMyCommands: jest.fn(async () => true), setChatMenuButton: jest.fn(async () => true), getMe: jest.fn(async () => ({ username: "B" })) } }) as any;
  const say = (text: string) => ({ message: { from: { id: 123 }, chat: { id: 123, type: "private" }, text } });
  afterEach(() => { pending = null; jest.restoreAllMocks(); });
  it("a main-menu tap while the note is awaited is navigation, not the note (it used to be sent to the admin as the request)", async () => {
    pending = { mode: "mm_note", reqId: "5" };
    const spy = jest.spyOn(trust, "submitMatchmakerNote");
    const bot = mkBot();
    expect(MAIN_MENU_LABELS.has("⭐ الترقيات والمزايا")).toBe(true);
    await handleMarriageBotUpdate(bot, row, say("⭐ الترقيات والمزايا"));
    expect(spy).not.toHaveBeenCalled();
    expect(db.$executeRaw.mock.calls.some((c: any[]) => c[0].join("?").includes("UPDATE match_matchmaker SET note"))).toBe(false);
    expect(db.matchUser.update).toHaveBeenCalledWith(expect.objectContaining({ data: { pendingAction: null } }));
  });
  it("real text is still taken as the note", async () => {
    pending = { mode: "mm_note", reqId: "5" };
    const bot = mkBot();
    await handleMarriageBotUpdate(bot, row, say("أبحث عن شريكة ملتزمة من عمّان بين 25 و30"));
    expect(db.$executeRaw.mock.calls.some((c: any[]) => c[0].join("?").includes("UPDATE match_matchmaker SET note"))).toBe(true);
  });
});
