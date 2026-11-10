// MARRIAGE_BOT owner-approved features (2026-11-11): digest opt-in/dedupe/privacy, «غير مناسب» ownership, cron auth.
process.env.SUPER_ADMIN_TELEGRAM_ID = "999";
process.env.CRON_SECRET = "test-secret";

const PID = "00000000-0000-4000-8000-0000000000aa";
const state: any = { claims: new Set<string>(), optin: new Map<string, boolean>(), sentRows: [] as any[], reqOwner: "123", queue: ["c1", "c2", "c3", "c4", "c5"], likedByMe: ["c1"], seen: ["c2"] };
const exec = jest.fn(async (strings: TemplateStringsArray, ...v: any[]) => {
  const q = strings.join("?");
  if (q.includes("INSERT INTO match_broadcast_log")) { const k = `${v[0]}|${v[1]}`; if (state.claims.has(k)) return 0; state.claims.add(k); return 1; }
  if (q.includes("INSERT INTO match_digest_optin")) { state.optin.set(v[0], v[2]); return 1; }
  if (q.includes("UPDATE match_matchmaker_sent SET verdict")) { const r = state.sentRows.find((x: any) => x.profile_id === v[2] && x.verdict == null); if (!r) return 0; r.verdict = v[0]; return 1; }
  return 0;
});
const query = jest.fn(async (strings: TemplateStringsArray, ...v: any[]) => {
  const q = strings.join("?");
  if (q.includes("FROM match_digest_optin WHERE user_id")) return state.optin.has(v[0]) ? [{ enabled: state.optin.get(v[0]) }] : [];
  if (q.includes("FROM match_broadcast_log WHERE campaign")) return v[0] === "dgp:123" ? state.seen.map((user_id: string) => ({ user_id })) : [];
  if (q.includes("FROM match_matchmaker WHERE id")) return [{ id: BigInt(v[0]), user_id: state.reqOwner, status: "OPEN", paid: 5, note: null }];
  if (q.includes("FROM match_matchmaker_sent WHERE req_id") && q.includes("SELECT 1")) return state.sentRows.filter((x: any) => x.profile_id === v[1]).map(() => ({ x: 1 }));
  return [];
});
const prof = (userId: string) => ({ id: `p-${userId}`, userId, gender: "FEMALE", age: 28, country: "سوريا", city: null, job: null, education: null, maritalStatus: null, status: "APPROVED", verificationStatus: "NONE", user: { lastActiveAt: new Date() } });
const db: any = {
  matchUser: { findUnique: jest.fn(async () => ({ id: "123", isBanned: false, mutedUntil: null, advancedFiltersUnlocked: false, vipUntil: null, profile: { ...prof("123"), gender: "MALE", age: 30 }, preference: null })) },
  matchProfile: { findMany: jest.fn(async ({ where }: any) => (where.userId?.in || []).map(prof)), findUnique: jest.fn(async () => prof("123")) },
  partnerPreference: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
  matchLike: { findMany: jest.fn(async ({ where }: any) => (where.fromUserId === "123" ? state.likedByMe.map((toUserId: string) => ({ toUserId })) : [])) },
  bot: { findMany: jest.fn(async () => []) },
  $queryRaw: query, $executeRaw: exec, $executeRawUnsafe: jest.fn(async () => 0), $queryRawUnsafe: jest.fn(async () => []),
};
jest.mock("@/lib/prisma", () => ({ prisma: db }));
jest.mock("@/lib/match/appStore", () => ({ ensureMatchAppTables: jest.fn(async () => undefined) }));
jest.mock("@/lib/match/extras", () => ({ quizOf: jest.fn(async () => new Map()) }));
const buildSearchQueue = jest.fn(async () => state.queue);
jest.mock("@/lib/matchBotLogic", () => ({
  buildSearchQueue: (...a: any[]) => (buildSearchQueue as any)(...a),
  compatibilityPercent: () => 50,
  defaultPref: (userId: string, p: any) => ({ userId, country: p.country, ageMin: null, ageMax: null }),
}));

import { digestPicksFor, handleDigestCallback, sendDigest } from "@/lib/match/engage";
import { markNotSuitable } from "@/lib/match/trust";
import { GET } from "@/app/api/cron/match-digest/route";

const fakeBot = () => ({ api: { sendMessage: jest.fn(async () => ({ message_id: 1 })), answerCallbackQuery: jest.fn(async () => true), getMe: jest.fn(async () => ({ username: "MarriageBot" })) } }) as any;

describe("🔔 daily digest", () => {
  beforeEach(() => { state.claims.clear(); });
  it("picks only from the bot's own privacy-filtered queue, skipping liked and already-sent profiles", async () => {
    const ids = await digestPicksFor("b1", "123");
    expect(buildSearchQueue).toHaveBeenCalled(); // blocks, «دولتي فقط», banned, approved-only live there
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain("c1");
    expect(ids).not.toContain("c2");
  });
  it("re-checks banned/approved/hidden on the picked profiles", async () => {
    await digestPicksFor("b1", "123");
    const where = db.matchProfile.findMany.mock.calls.at(-1)[0].where;
    expect(where).toMatchObject({ status: "APPROVED", isHidden: false, user: { isBanned: false } });
  });
  it("a banned or muted member gets nothing", async () => {
    db.matchUser.findUnique.mockResolvedValueOnce({ id: "123", isBanned: true, profile: prof("123"), preference: null });
    expect(await digestPicksFor("b1", "123")).toEqual([]);
  });
  it("sends once a day with an opt-out button, and remembers what it sent", async () => {
    const bot = fakeBot();
    expect(await sendDigest(bot, "b1", "123", "2026-11-11")).toBe("sent");
    const [, text, opts] = bot.api.sendMessage.mock.calls[0];
    expect(text).toContain("أفضل 3 مطابقات");
    expect(JSON.stringify(opts.reply_markup)).toContain("mdg_off");
    expect(JSON.stringify(opts.reply_markup)).toContain("start=profile_p-c3");
    expect(state.claims.has("dgp:123|c3")).toBe(true);
    expect(await sendDigest(bot, "b1", "123", "2026-11-11")).toBe("dup");
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("mdg_off / mdg_on switch the member's own setting", async () => {
    const bot = fakeBot();
    expect(await handleDigestCallback(bot, "b1", { id: "q", data: "mdg_on", from: { id: 123 }, message: { chat: { id: 123 } } })).toBe(true);
    expect(state.optin.get("123")).toBe(true);
    await handleDigestCallback(bot, "b1", { id: "q", data: "mdg_off", from: { id: 123 }, message: { chat: { id: 123 } } });
    expect(state.optin.get("123")).toBe(false);
    expect(await handleDigestCallback(bot, "b1", { id: "q", data: "mlike|1", from: { id: 123 } })).toBe(false);
  });
});

describe("🔔 digest cron", () => {
  it("rejects calls without the CRON_SECRET bearer", async () => {
    const res = await GET({ headers: new Headers({ authorization: "Bearer wrong" }) } as any);
    expect(res.status).toBe(401);
    const ok = await GET({ headers: new Headers({ authorization: "Bearer test-secret" }) } as any);
    expect(ok.status).toBe(200);
  });
});

describe("🙅 not suitable", () => {
  beforeEach(() => { state.sentRows = [{ req_id: 7n, profile_id: PID, verdict: null }]; });
  it("only the member who owns the request can mark it, once", async () => {
    const bot = fakeBot();
    state.reqOwner = "123";
    expect(await markNotSuitable(bot, "456", "7", PID, "age")).toBe("invalid");
    expect(state.sentRows[0].verdict).toBeNull();
    expect(await markNotSuitable(bot, "123", "7", PID, "age")).toBe("ok");
    expect(state.sentRows[0].verdict).toBe("age");
    expect(await markNotSuitable(bot, "123", "7", PID, "place")).toBe("dup");
    expect(bot.api.sendMessage).toHaveBeenCalledTimes(1); // the admin hears it once
  });
  it("rejects a profile that was never suggested and malformed ids", async () => {
    const bot = fakeBot();
    expect(await markNotSuitable(bot, "123", "7", "00000000-0000-4000-8000-0000000000bb", "age")).toBe("invalid");
    expect(await markNotSuitable(bot, "123", "x", PID, "age")).toBe("invalid");
  });
});
