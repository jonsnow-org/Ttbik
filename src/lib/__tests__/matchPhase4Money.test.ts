// Phase 4 audit (MARRIAGE_BOT): money paths that could charge twice, matchmaker races and privacy, written to fail on
// the old code first. One in-memory database; every mock call yields (setImmediate) so two parallel calls interleave
// the way two webhook/app requests do.
process.env.SUPER_ADMIN_TELEGRAM_ID = "999";

const tick = () => new Promise((r) => setImmediate(r));
type U = { id: string; botId: string; balance: number; vipUntil: Date | null; profileVisitorsUnlocked: boolean; advancedFiltersUnlocked: boolean; extraPhotosUnlocked: boolean; isBanned: boolean; lastActiveAt: Date; pendingAction: any };
const S: any = {};
function reset() {
  S.users = new Map<string, U>();
  S.profiles = [] as any[];
  S.prefs = new Map<string, any>();
  S.likes = [] as { fromUserId: string; toUserId: string }[];
  S.blocks = [] as { blockerId: string; blockedId: string }[];
  S.privacy = new Set<string>();
  S.tx = [] as any[];
  S.rl = new Map<string, number>();
  S.dmUnlock = new Set<string>();
  S.mm = [] as any[];
  S.mmSent = new Set<string>();
  S.passes = [] as { user_id: string; target_id: string }[];
}
reset();
const user = (id: string, o: Partial<U> = {}): U => {
  const u: U = { id, botId: "b1", balance: 0, vipUntil: null, profileVisitorsUnlocked: false, advancedFiltersUnlocked: false, extraPhotosUnlocked: false, isBanned: false, lastActiveAt: new Date(), pendingAction: null, ...o };
  S.users.set(id, u);
  return u;
};
let pid = 0;
const profile = (userId: string, o: any = {}) => {
  const p = { id: `00000000-0000-4000-8000-${String(++pid).padStart(12, "0")}`, userId, gender: "FEMALE", name: "x", age: 27, country: "الأردن", city: null, job: null, education: null, maritalStatus: null, attributes: null, status: "APPROVED", isHidden: false, verificationStatus: "NONE", verificationPhotoFileId: null, boostedUntil: null, photoFileId: null, ...o };
  S.profiles.push(p);
  return p;
};
const withUser = (p: any) => (p ? { ...p, user: S.users.get(p.userId) } : null);
const pick = (o: any, select?: any) => (select && o ? Object.fromEntries(Object.keys(select).map((k) => [k, o[k]])) : o);

const db: any = {
  matchUser: {
    findUnique: jest.fn(async ({ where, select }: any) => { await tick(); const u = S.users.get(where.id); return u ? pick({ ...u }, select) : null; }),
    update: jest.fn(async ({ where, data }: any) => { await tick(); const u = S.users.get(where.id); if (!u) throw new Error("nf"); Object.assign(u, data); return { ...u }; }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      await tick();
      const u = S.users.get(where.id);
      if (!u) return { count: 0 };
      if (where.balance?.gte != null && !(u.balance >= where.balance.gte)) return { count: 0 };
      if (data.balance?.decrement != null) u.balance = Math.round((u.balance - data.balance.decrement) * 100) / 100;
      return { count: 1 };
    }),
  },
  matchTransaction: {
    create: jest.fn(async ({ data }: any) => { await tick(); S.tx.push(data); return data; }),
    count: jest.fn(async ({ where }: any) => { await tick(); return S.tx.filter((t: any) => t.userId === where.userId && (!where.type?.in || where.type.in.includes(t.type))).length; }),
  },
  matchProfile: {
    findUnique: jest.fn(async ({ where, include, select }: any) => {
      await tick();
      const p = S.profiles.find((x: any) => (where.userId && x.userId === where.userId) || (where.id && x.id === where.id));
      if (!p) return null;
      return select ? pick(p, select) : include?.user ? withUser({ ...p }) : { ...p };
    }),
    update: jest.fn(async ({ where, data }: any) => { await tick(); const p = S.profiles.find((x: any) => x.userId === where.userId); Object.assign(p, data); return { ...p }; }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      await tick();
      const p = S.profiles.find((x: any) => x.userId === where.userId);
      if (!p || (where.verificationStatus !== undefined && p.verificationStatus !== where.verificationStatus)) return { count: 0 };
      Object.assign(p, data);
      return { count: 1 };
    }),
    findMany: jest.fn(async ({ where }: any) => {
      await tick();
      return S.profiles
        .filter((p: any) => p.status === where.status && p.isHidden === where.isHidden && p.gender === where.gender && p.userId !== where.userId?.not)
        .map(withUser)
        .filter((p: any) => p.user.botId === where.user.botId && (where.user.isBanned === undefined || p.user.isBanned === where.user.isBanned));
    }),
  },
  partnerPreference: {
    findUnique: jest.fn(async ({ where }: any) => { await tick(); return S.prefs.get(where.userId) ?? null; }),
    findMany: jest.fn(async ({ where }: any) => { await tick(); return where.userId.in.filter((id: string) => S.prefs.has(id)).map((id: string) => ({ userId: id, ...S.prefs.get(id) })); }),
  },
  matchLike: {
    findUnique: jest.fn(async ({ where }: any) => { await tick(); const k = where.fromUserId_toUserId; return S.likes.find((l: any) => l.fromUserId === k.fromUserId && l.toUserId === k.toUserId) ?? null; }),
    findMany: jest.fn(async ({ where }: any) => {
      await tick();
      const ok = (cond: any, v: string) => (cond === undefined ? true : typeof cond === "string" ? cond === v : cond.in.includes(v));
      return S.likes.filter((l: any) => ok(where.fromUserId, l.fromUserId) && ok(where.toUserId, l.toUserId));
    }),
  },
  matchBlock: {
    findMany: jest.fn(async ({ where }: any) => { await tick(); const u = where.OR[0].blockerId; return S.blocks.filter((b: any) => b.blockerId === u || b.blockedId === u); }),
    findFirst: jest.fn(async ({ where }: any) => { await tick(); return S.blocks.find((b: any) => where.OR.some((o: any) => o.blockerId === b.blockerId && o.blockedId === b.blockedId)) ?? null; }),
  },
  matchProfilePrivacy: {
    findMany: jest.fn(async ({ where }: any) => { await tick(); return where.userId.in.filter((id: string) => S.privacy.has(id)).map((userId: string) => ({ userId })); }),
  },
  $transaction: jest.fn(async (fn: any) => fn(db)),
  $executeRawUnsafe: jest.fn(async () => 0),
  $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...v: any[]) => {
    await tick();
    const q = strings.join("?");
    if (q.includes("FROM match_first_discount")) return [{ x: 1 }]; // discount already used: keeps the arithmetic simple
    if (q.includes("FROM match_dm_unlock")) return S.dmUnlock.has(`${v[0]}:${v[1]}`) ? [{ x: 1 }] : [];
    if (q.includes("FROM match_dm WHERE")) return [{ n: BigInt(0) }];
    if (q.includes("FROM match_matchmaker WHERE user_id")) {
      const r = [...S.mm].reverse().find((m: any) => m.user_id === v[0] && ["AWAITING_NOTE", "OPEN"].includes(m.status));
      return r ? [{ id: BigInt(r.id), status: r.status }] : [];
    }
    if (q.includes("INSERT INTO match_matchmaker ")) { const id = S.mm.length + 1; S.mm.push({ id, user_id: v[0], bot_id: v[1], paid: v[2], status: "AWAITING_NOTE", note: null }); return [{ id: BigInt(id) }]; }
    if (q.includes("FROM match_matchmaker WHERE id")) { const r = S.mm.find((m: any) => BigInt(m.id) === v[0]); return r ? [{ ...r, id: BigInt(r.id) }] : []; }
    if (q.includes("FROM match_matchmaker_sent")) return [...S.mmSent].filter((k: string) => k.startsWith(`${v[0]}:`)).map((k: string) => ({ profile_id: k.split(":")[1], n: 0 }));
    if (q.includes("FROM match_app_passes_log")) return S.passes.filter((p: any) => p.user_id === v[0]);
    return [];
  }),
  $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...v: any[]) => {
    await tick();
    const q = strings.join("?");
    if (q.includes("DELETE FROM match_rate_limits")) { S.rl.delete(v[0]); return 1; }
    if (q.includes("INSERT INTO match_dm_unlock")) { const k = `${v[0]}:${v[1]}`; if (S.dmUnlock.has(k)) return 0; S.dmUnlock.add(k); return 1; }
    if (q.includes("DELETE FROM match_dm_unlock")) { S.dmUnlock.delete(`${v[0]}:${v[1]}`); return 1; }
    if (q.includes("UPDATE match_matchmaker SET note")) {
      const r = S.mm.find((m: any) => BigInt(m.id) === v[1] && m.user_id === v[2] && m.status === "AWAITING_NOTE");
      if (!r) return 0;
      r.note = v[0]; r.status = "OPEN";
      return 1;
    }
    if (q.includes("INSERT INTO match_matchmaker_sent")) { const k = `${v[0]}:${v[1]}`; if (S.mmSent.has(k)) return 0; S.mmSent.add(k); return 1; }
    return 1;
  }),
};
jest.mock("@/lib/prisma", () => ({ prisma: db }));
jest.mock("@/lib/match/appStore", () => ({ ensureMatchAppTables: async () => undefined, extendAnonPaidUntilAtomic: jest.fn(), getAnonFilterRow: jest.fn() }));
// The real fixed-window limiter, in memory (the short lock is built on it).
jest.mock("@/lib/match/rateLimitPg", () => ({
  pgRateLimit: async (key: string, max: number) => { await new Promise((r) => setImmediate(r)); const n = (S.rl.get(key) || 0) + 1; S.rl.set(key, n); return n <= max; },
}));
jest.mock("@/lib/match/growth", () => ({ trackFunnel: jest.fn(async () => undefined) }));
jest.mock("@/lib/match/hybrid", () => ({ botUsername: jest.fn(async () => "MatchBot"), publicCardKeyboard: jest.fn(() => ({ inline_keyboard: [] })) }));

import * as ent from "@/lib/match/entitlements";
import { unlockDm } from "@/lib/match/social";
import * as trust from "@/lib/match/trust";
import { PRICE_BOOST_24H, PRICE_PROFILE_VISITORS, PRICE_VIP_30D, PRICE_VERIFIED_BADGE, PRICE_VIP_TRIAL } from "@/lib/match/entitlementRules";
import { PRICE_MATCHMAKER } from "@/lib/match/trustRules";

const charges = (type?: string) => S.tx.filter((t: any) => t.currency === "internal" && (!type || t.type === type));
const mkBot = () => ({ api: { sendMessage: jest.fn(async () => ({ message_id: 1 })), answerCallbackQuery: jest.fn(async () => true), sendInvoice: jest.fn(async () => ({})) } }) as any;
beforeEach(() => { reset(); pid = 0; });

describe("one-time and stacking purchases never charge twice for one tap", () => {
  it("two parallel «👀 من زار ملفي» unlocks charge once", async () => {
    user("u1", { balance: 10 });
    const [a, b] = await Promise.all([ent.unlockProfileVisitors("u1"), ent.unlockProfileVisitors("u1")]);
    expect(charges("PROFILE_VISITORS")).toHaveLength(1);
    expect(S.users.get("u1").balance).toBe(10 - PRICE_PROFILE_VISITORS);
    expect([a, b].filter((r: any) => r.ok && r.charged)).toHaveLength(1);
  });
  it("two parallel golden memberships charge once (the second used to pay $8 for no extra days)", async () => {
    user("u1", { balance: 20 });
    await Promise.all([ent.purchaseVip("u1"), ent.purchaseVip("u1")]);
    expect(charges("VIP_MEMBERSHIP")).toHaveLength(1);
    expect(S.users.get("u1").balance).toBe(20 - PRICE_VIP_30D);
  });
  it("two parallel ✨ trials charge once", async () => {
    user("u1", { balance: 5 });
    await Promise.all([ent.purchaseVipTrial("u1"), ent.purchaseVipTrial("u1")]);
    expect(charges("VIP_TRIAL")).toHaveLength(1);
    expect(S.users.get("u1").balance).toBe(5 - PRICE_VIP_TRIAL);
  });
  it("two parallel 🚀 boosts charge once", async () => {
    user("u1", { balance: 10 }); profile("u1");
    await Promise.all([ent.purchaseBoost("u1"), ent.purchaseBoost("u1")]);
    expect(charges("BOOST")).toHaveLength(1);
  });
  it("a boost bought while still boosted adds 24h to the remaining time instead of restarting", async () => {
    user("u1", { balance: 10 });
    const until = new Date(Date.now() + 10 * 3600_000);
    profile("u1", { boostedUntil: until });
    const r: any = await ent.purchaseBoost("u1");
    expect(r.ok).toBe(true);
    expect(r.boostedUntil.getTime()).toBe(until.getTime() + 24 * 3600_000);
    expect(S.users.get("u1").balance).toBe(10 - PRICE_BOOST_24H);
  });
  it("a sequential second tap after the lock is released still works (no permanent lock)", async () => {
    user("u1", { balance: 10 }); profile("u1");
    await ent.purchaseBoost("u1");
    await ent.purchaseBoost("u1");
    expect(charges("BOOST")).toHaveLength(2);
  });
});

describe("☑️ verification photo", () => {
  it("two photos sent together charge the review fee once", async () => {
    user("u1", { balance: 10 }); profile("u1");
    const [a, b] = await Promise.all([ent.submitVerificationPhoto("u1", "f1"), ent.submitVerificationPhoto("u1", "f2")]);
    expect(charges("VERIFIED_BADGE")).toHaveLength(1);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect(S.profiles[0].verificationStatus).toBe("PENDING");
  });
  it("not enough balance: nothing charged and the old status comes back", async () => {
    user("u1", { balance: 1 }); profile("u1", { verificationStatus: "REJECTED" });
    const r = await ent.submitVerificationPhoto("u1", "f1");
    expect(r).toMatchObject({ ok: false, reason: "insufficient", needed: PRICE_VERIFIED_BADGE });
    expect(S.profiles[0].verificationStatus).toBe("REJECTED");
    expect(charges()).toHaveLength(0);
  });
  it("already pending or verified: no charge", async () => {
    user("u1", { balance: 10 }); profile("u1", { verificationStatus: "PENDING" });
    expect(await ent.submitVerificationPhoto("u1", "f1")).toEqual({ ok: false, reason: "already" });
    expect(charges()).toHaveLength(0);
  });
});

describe("🔓 DM unlock", () => {
  it("two parallel unlocks of the same chat charge once", async () => {
    user("u1", { balance: 10 }); user("u2");
    const [a, b] = await Promise.all([unlockDm("u1", "u2"), unlockDm("u1", "u2")]);
    expect(a.ok && b.ok).toBe(true);
    expect(charges("DM_UNLOCK")).toHaveLength(1);
  });
  it("a failed charge releases the claim, so paying later works", async () => {
    user("u1", { balance: 0 }); user("u2");
    expect((await unlockDm("u1", "u2")).ok).toBe(false);
    expect(S.dmUnlock.size).toBe(0);
    S.users.get("u1").balance = 10;
    expect((await unlockDm("u1", "u2")).ok).toBe(true);
    expect(charges("DM_UNLOCK")).toHaveLength(1);
  });
});

describe("💍 matchmaker purchase and note", () => {
  it("two parallel «✅ اطلب الخاطبة» charge $5 once and open one request", async () => {
    user("u1", { balance: 20 }); profile("u1", { gender: "MALE" });
    await Promise.all([trust.buyMatchmakerCore("u1", "b1"), trust.buyMatchmakerCore("u1", "b1")]);
    expect(charges("MATCHMAKER")).toHaveLength(1);
    expect(S.mm).toHaveLength(1);
    expect(S.users.get("u1").balance).toBe(20 - PRICE_MATCHMAKER);
  });
  it("no balance: nothing charged, the exact shortfall in Stars is returned", async () => {
    user("u1", { balance: 2 }); profile("u1", { gender: "MALE" });
    expect(await trust.buyMatchmakerCore("u1", "b1")).toEqual({ status: "insufficient", balance: 2, stars: 300 });
    expect(S.mm).toHaveLength(0);
  });
  it("a note sent twice reaches the admin once", async () => {
    user("u1", { balance: 20 }); profile("u1", { gender: "MALE" });
    const r: any = await trust.buyMatchmakerCore("u1", "b1");
    const bot = mkBot();
    const note = "أبحث عن شريكة من الأردن بين 24 و30";
    const [a, b] = await Promise.all([trust.submitMatchmakerNote(bot, "u1", r.reqId, note), trust.submitMatchmakerNote(bot, "u1", r.reqId, note)]);
    expect([a.status, b.status].sort()).toEqual(["saved", "stale"]);
    const toAdmin = bot.api.sendMessage.mock.calls.filter((c: any[]) => c[0] === 999 && String(c[1]).includes("طلب خاطبة جديد"));
    expect(toAdmin).toHaveLength(1);
  });
});

describe("💍 matchmaker candidates: privacy and repeats", () => {
  const setup = () => {
    user("me", { balance: 0 }); profile("me", { gender: "MALE", age: 30, country: "الأردن" });
    S.prefs.set("me", { country: "الأردن", ageMin: 24, ageMax: 30 });
    S.mm.push({ id: 1, user_id: "me", bot_id: "b1", paid: 5, status: "OPEN", note: "أبحث عن شريكة" });
  };
  it("skips «لدولتي فقط» profiles from another country, profiles the requester already liked, and blocks", async () => {
    setup();
    user("eg"); const pEg = profile("eg", { country: "مصر" }); S.privacy.add("eg");
    user("liked"); const pLiked = profile("liked"); S.likes.push({ fromUserId: "me", toUserId: "liked" });
    user("blk"); const pBlk = profile("blk"); S.blocks.push({ blockerId: "blk", blockedId: "me" });
    user("ok"); const pOk = profile("ok");
    const found: any = await trust.findMatchmakerCandidates("1");
    const ids = found.list.map((p: any) => p.id);
    expect(ids).toEqual([pOk.id]);
    expect(ids).not.toContain(pEg.id);
    expect(ids).not.toContain(pLiked.id);
    expect(ids).not.toContain(pBlk.id);
    expect(found.counts).toMatchObject({ liked: 1, hidden: 2 });
  });
  it("ranks a profile whose own wishes fit the requester, and one that already liked him, above an equal one", async () => {
    setup();
    user("plain"); const plain = profile("plain");
    user("fit"); const fit = profile("fit"); S.prefs.set("fit", { country: "الأردن", ageMin: 28, ageMax: 35 });
    user("fan"); const fan = profile("fan"); S.likes.push({ fromUserId: "fan", toUserId: "me" });
    const found: any = await trust.findMatchmakerCandidates("1");
    const order = found.list.map((p: any) => p.id);
    expect(order.indexOf(fan.id)).toBeLessThan(order.indexOf(plain.id));
    expect(order.indexOf(fit.id)).toBeLessThan(order.indexOf(plain.id));
    expect(found.why.get(fit.id)).toContain("يناسب مواصفاته هو أيضاً");
  });
  it("«📤 اقترح» re-checks at send time: a block made after the list was built stops the card", async () => {
    setup();
    user("x"); const px = profile("x");
    S.blocks.push({ blockerId: "x", blockedId: "me" });
    const bot = mkBot();
    expect(await trust.sendSuggestion(bot, { id: "b1" } as any, "1", px.id)).toBe("gone");
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });
  it("«📤 اقترح» does not send a «لدولتي فقط» profile to another country, nor to a banned requester", async () => {
    setup();
    user("eg"); const pEg = profile("eg", { country: "مصر" }); S.privacy.add("eg");
    const bot = mkBot();
    expect(await trust.sendSuggestion(bot, { id: "b1" } as any, "1", pEg.id)).toBe("gone");
    user("ok"); const pOk = profile("ok");
    S.users.get("me").isBanned = true;
    expect(await trust.sendSuggestion(bot, { id: "b1" } as any, "1", pOk.id)).toBe("gone");
    expect(bot.api.sendMessage).not.toHaveBeenCalled();
  });
  it("still sends a fine profile, once", async () => {
    setup();
    user("ok"); const pOk = profile("ok");
    const bot = mkBot();
    expect(await trust.sendSuggestion(bot, { id: "b1" } as any, "1", pOk.id)).toBe("sent");
    expect(await trust.sendSuggestion(bot, { id: "b1" } as any, "1", pOk.id)).toBe("dup");
  });
});
