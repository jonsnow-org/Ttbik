jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/services/ton-service", () => ({ getTonUsdRateStrict: jest.fn(), isNativeTonConfigured: jest.fn(), isTonAddress: (a: string) => a.startsWith("UQ"), sendTonWithdrawal: jest.fn() }));
import { planSweep, ownerPayoutAddress } from "@/lib/ownerPayout";

const base = { accumulatedUsd: 50, thresholdUsd: 15, perTxCapUsd: 100, dailyCapUsd: 200, sentTodayUsd: 0, rate: 2 };
describe("planSweep", () => {
  it("sweeps everything under the caps", () => expect(planSweep(base)).toEqual({ ok: true, amountUsd: 50, amountTon: 25 }));
  it("waits below the threshold", () => expect(planSweep({ ...base, accumulatedUsd: 15 })).toEqual({ ok: false, reason: "below_threshold" }));
  it("respects the per-transfer cap", () => expect(planSweep({ ...base, accumulatedUsd: 500 })).toMatchObject({ ok: true, amountUsd: 100 }));
  it("respects the daily cap across transfers", () => expect(planSweep({ ...base, accumulatedUsd: 500, sentTodayUsd: 150 })).toMatchObject({ ok: true, amountUsd: 50 }));
  it("stops when the daily cap is used", () => expect(planSweep({ ...base, sentTodayUsd: 200 })).toEqual({ ok: false, reason: "daily_cap" }));
  it("never sweeps without a real rate", () => expect(planSweep({ ...base, rate: 0 })).toEqual({ ok: false, reason: "no_rate" }));
  it("manual sweep (threshold 0) takes small balances too", () => expect(planSweep({ ...base, accumulatedUsd: 3, thresholdUsd: 0 })).toMatchObject({ ok: true, amountUsd: 3 }));
  it("rounds the USD amount down, never up", () => expect(planSweep({ ...base, accumulatedUsd: 20.999 })).toMatchObject({ amountUsd: 20.99 }));
});
describe("ownerPayoutAddress", () => {
  const keep = { ...process.env };
  afterEach(() => { process.env = { ...keep }; });
  it("is null when unset or invalid", () => {
    delete process.env.OWNER_PAYOUT_WALLET; delete process.env.OWNER_CWALLET_ADDRESS;
    expect(ownerPayoutAddress()).toBeNull();
    process.env.OWNER_PAYOUT_WALLET = "not-an-address";
    expect(ownerPayoutAddress()).toBeNull();
  });
  it("prefers OWNER_PAYOUT_WALLET, falls back to the legacy name", () => {
    process.env.OWNER_CWALLET_ADDRESS = "UQlegacy";
    expect(ownerPayoutAddress()).toBe("UQlegacy");
    process.env.OWNER_PAYOUT_WALLET = "UQnew";
    expect(ownerPayoutAddress()).toBe("UQnew");
  });
});
