// ✨ The cheap golden trial ($0.5 = 50 Stars, 3 days, once) and the golden-day referral reward.
const db: any = {
  matchUser: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
  matchTransaction: { create: jest.fn(), count: jest.fn() },
  $transaction: jest.fn(async (fn: any) => fn(db)),
  $queryRaw: jest.fn(async () => []),
  $executeRaw: jest.fn(async () => 1),
};
jest.mock("@/lib/prisma", () => ({ prisma: db }));
jest.mock("@/lib/match/rateLimitPg", () => ({ pgRateLimit: jest.fn(async () => true) }));
jest.mock("@/lib/match/appStore", () => ({ ensureMatchAppTables: async () => undefined, extendAnonPaidUntilAtomic: jest.fn(), getAnonFilterRow: jest.fn() }));

import { BUY_NOW_PRICE, PRICE_VIP_TRIAL, UPGRADE_CATALOGUE, VIP_TRIAL_DAYS, isBuyNowKey, vipTrialEligible } from "@/lib/match/entitlementRules";
import { grantReferralVip, purchaseByKey, purchaseVipTrial } from "@/lib/match/entitlements";
import { starsForUsd } from "@/lib/starsPayment";

beforeEach(() => jest.resetAllMocks());
const restore = () => { require("@/lib/match/rateLimitPg").pgRateLimit.mockResolvedValue(true); db.$transaction.mockImplementation(async (fn: any) => fn(db)); db.$queryRaw.mockResolvedValue([]); db.$executeRaw.mockResolvedValue(1); };

describe("golden trial rules", () => {
  it("costs 50 Stars for 3 days and is a one-tap Stars purchase listed first", () => {
    expect(PRICE_VIP_TRIAL).toBe(0.5);
    expect(starsForUsd(PRICE_VIP_TRIAL)).toBe(50);
    expect(VIP_TRIAL_DAYS).toBe(3);
    expect(isBuyNowKey("vipTrial")).toBe(true);
    expect(BUY_NOW_PRICE.vipTrial).toEqual({ price: 0.5, type: "VIP_TRIAL" });
    expect(UPGRADE_CATALOGUE[0].key).toBe("vipTrial");
  });
  it("only for accounts that never had paid golden time", () => {
    expect(vipTrialEligible({ vipActive: false, priorTrialOrVip: 0 })).toBe(true);
    expect(vipTrialEligible({ vipActive: true, priorTrialOrVip: 0 })).toBe(false);
    expect(vipTrialEligible({ vipActive: false, priorTrialOrVip: 1 })).toBe(false);
  });
});

describe("purchaseVipTrial", () => {
  beforeEach(restore);
  it("charges $0.5 from balance and grants 3 golden days", async () => {
    db.matchUser.findUnique.mockResolvedValueOnce({ vipUntil: null }).mockResolvedValueOnce({ balance: 0 });
    db.matchTransaction.count.mockResolvedValueOnce(0);
    db.matchUser.updateMany.mockResolvedValueOnce({ count: 1 });
    const before = Date.now();
    const r: any = await purchaseVipTrial("7");
    expect(r.ok).toBe(true);
    expect(db.matchUser.updateMany).toHaveBeenCalledWith({ where: { id: "7", balance: { gte: 0.5 } }, data: { balance: { decrement: 0.5 } } });
    expect(db.matchTransaction.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: "7", amount: 0.5, type: "VIP_TRIAL" }) });
    const days = (r.vipUntil.getTime() - before) / 86400_000;
    expect(days).toBeGreaterThan(2.99);
    expect(days).toBeLessThan(3.01);
  });
  it("refuses a second trial without charging", async () => {
    db.matchUser.findUnique.mockResolvedValueOnce({ vipUntil: null });
    db.matchTransaction.count.mockResolvedValueOnce(1);
    expect(await purchaseVipTrial("7")).toEqual({ ok: false, reason: "trial_used" });
    expect(db.matchUser.updateMany).not.toHaveBeenCalled();
  });
  it("insufficient balance → the Stars buy-now path (shortfall) takes over", async () => {
    db.matchUser.findUnique.mockResolvedValueOnce({ vipUntil: null }).mockResolvedValueOnce({ balance: 0 });
    db.matchTransaction.count.mockResolvedValueOnce(0);
    db.matchUser.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await purchaseByKey("7", "vipTrial")).toMatchObject({ ok: false, reason: "insufficient", needed: 0.5 });
  });
});

describe("referral golden day", () => {
  beforeEach(restore);
  it("adds 24h of golden time on top of any remaining time", async () => {
    const until = new Date(Date.now() + 5 * 86400_000);
    db.matchUser.findUnique.mockResolvedValueOnce({ vipUntil: until });
    const r = await grantReferralVip("9");
    expect(r!.getTime()).toBe(until.getTime() + 24 * 3600_000);
    expect(db.matchUser.update).toHaveBeenCalledWith({ where: { id: "9" }, data: { vipUntil: r } });
  });
});
