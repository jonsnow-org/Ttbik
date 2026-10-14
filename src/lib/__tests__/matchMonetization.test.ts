const db: any = {
  matchUser: { findUnique: jest.fn(), updateMany: jest.fn() },
  matchTransaction: { create: jest.fn(), count: jest.fn(async () => 1) },
  $transaction: jest.fn(async (fn: any) => fn(db)),
  $queryRaw: jest.fn(),
  $executeRaw: jest.fn(async () => 1),
};
jest.mock("@/lib/prisma", () => ({ prisma: db }));
jest.mock("@/lib/match/rateLimitPg", () => ({ pgRateLimit: jest.fn(async () => true) }));
jest.mock("@/lib/match/appStore", () => ({ ensureMatchAppTables: async () => undefined, extendAnonPaidUntilAtomic: jest.fn(), getAnonFilterRow: jest.fn() }));

import { BUY_NOW_KEYS, FIRST_PURCHASE_DISCOUNT, PRICE_REWIND, discountedPrice, isBuyNowKey, shortfallUsd } from "@/lib/match/entitlementRules";
import { purchaseRewind } from "@/lib/match/entitlements";
import { starsForUsd } from "@/lib/starsPayment";

describe("monetization rules", () => {
  it("first purchase discount is 20%, rounded to cents", () => {
    expect(FIRST_PURCHASE_DISCOUNT).toBe(0.2);
    expect(discountedPrice(8, true)).toBe(6.4);
    expect(discountedPrice(2, false)).toBe(2);
  });
  it("buy-now only covers instant upgrades (not verify/photos which need a bot upload)", () => {
    expect([...BUY_NOW_KEYS].sort()).toEqual(["anonFilters", "boost", "filters", "vip", "visitors"]);
    expect(isBuyNowKey("verify")).toBe(false);
  });
  it("shortfall is the exact missing amount (min 1 cent) → stars", () => {
    expect(shortfallUsd(2, 0.5)).toBe(1.5);
    expect(starsForUsd(shortfallUsd(2, 0.5))).toBe(150);
    expect(shortfallUsd(2, 1.999)).toBe(0.01);
  });
  it("rewind price", () => expect(PRICE_REWIND).toBe(0.5));
});

describe("purchaseRewind", () => {
  beforeEach(() => jest.clearAllMocks());
  it("pops the last pass and charges $0.5", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ target_id: "77", created_at: new Date() }]);
    db.matchUser.updateMany.mockResolvedValueOnce({ count: 1 });
    db.matchUser.findUnique.mockResolvedValueOnce({ balance: 1 });
    const r = await purchaseRewind("1");
    expect(r).toEqual({ ok: true, targetId: "77" });
    expect(db.matchUser.updateMany).toHaveBeenCalledWith({ where: { id: "1", balance: { gte: 0.5 } }, data: { balance: { decrement: 0.5 } } });
  });
  it("puts the pass back when the balance is too low", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ target_id: "77", created_at: new Date() }]);
    db.matchUser.updateMany.mockResolvedValueOnce({ count: 0 });
    db.matchUser.findUnique.mockResolvedValueOnce({ balance: 0.1 });
    const r = await purchaseRewind("1");
    expect(r).toMatchObject({ ok: false, reason: "insufficient" });
    const reinserted = db.$executeRaw.mock.calls.some((c: any[]) => (c[0] as string[]).join("").includes("INSERT INTO match_app_passes_log"));
    expect(reinserted).toBe(true);
  });
  it("nothing to rewind → no charge", async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    expect(await purchaseRewind("1")).toEqual({ ok: false, reason: "no_pass" });
    expect(db.matchUser.updateMany).not.toHaveBeenCalled();
  });
});
