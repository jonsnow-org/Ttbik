import { storeNetProfit } from "@/lib/storeProfit";

const base = { price: 100, cost: 40, shipping: 10, gatewayPct: 2.5, gatewayFixed: 1, platformPct: 2, adPerOrder: 15, returnPct: 0, orders: 100 };

describe("store net profit", () => {
  it("adds up a kept order exactly", () => {
    const r = storeNetProfit(base);
    expect(r.feesPerOrder).toBeCloseTo(100 * 0.045 + 1, 6);        // 5.5
    expect(r.profitDelivered).toBeCloseTo(100 - 40 - 10 - 5.5 - 15, 6); // 29.5
    expect(r.expectedPerOrder).toBeCloseTo(29.5, 6);
    expect(r.monthly).toBeCloseTo(2950, 4);
    expect(r.netMarginPct).toBeCloseTo(29.5, 4);
  });
  it("returns cost shipping both ways, the fixed fee and the ad, and recover the product", () => {
    const r = storeNetProfit({ ...base, returnPct: 20 });
    expect(r.lossReturned).toBeCloseTo(-(20) - 1 - 15, 6);        // -36
    expect(r.expectedPerOrder).toBeCloseTo(0.8 * 29.5 + 0.2 * -36, 6);
  });
  it("the break-even ad spend gives exactly zero profit, and ROAS follows from it", () => {
    for (const returnPct of [0, 10, 35]) {
      const r = storeNetProfit({ ...base, returnPct });
      const at = storeNetProfit({ ...base, returnPct, adPerOrder: r.maxAdPerOrder });
      expect(at.expectedPerOrder).toBeCloseTo(0, 6);
      if (r.breakEvenRoas != null) expect(r.breakEvenRoas).toBeCloseTo(100 / r.maxAdPerOrder, 6);
    }
  });
  it("is safe on empty, negative or silly input", () => {
    const r = storeNetProfit({ price: NaN, cost: -5, shipping: Infinity, gatewayPct: 500, gatewayFixed: 0, platformPct: 0, adPerOrder: 0, returnPct: 900, orders: -1 });
    for (const v of Object.values(r)) expect(v === null || Number.isFinite(v as number)).toBe(true);
    expect(r.breakEvenRoas).toBeNull();
  });
  it("no break-even ROAS when the product cannot pay for itself", () => {
    expect(storeNetProfit({ ...base, cost: 95 }).breakEvenRoas).toBeNull();
  });
});
