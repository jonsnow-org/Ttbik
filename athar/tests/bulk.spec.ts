import { pickDates, planBatches, estimate } from "../web/lib/bulk";
import { toNano } from "@ton/core";

describe("planning the owner's stock", () => {
  const cands = Array.from({ length: 1000 }, (_, i) => 100 + i);
  it("spreads the dates evenly over the whole range, never twice, never more than are free", () => {
    const d = pickDates(cands, 10, "spread");
    expect(d.length).toBe(10);
    expect(new Set(d).size).toBe(10);
    expect(d[0]).toBeLessThan(160); expect(d[9]).toBeGreaterThan(1040);
    for (let i = 1; i < d.length; i++) expect(d[i] - d[i - 1]).toBeGreaterThan(80);   // no neighbouring days
    expect(pickDates(cands, 5000).length).toBe(1000);
    expect(pickDates([], 10)).toEqual([]);
    expect(pickDates(cands, 0)).toEqual([]);
  });
  it("'start' takes the earliest", () => { expect(pickDates(cands, 3, "start")).toEqual([100, 101, 102]); });
  it("splits into confirmations the wallet accepts and can fund", () => {
    const dates = Array.from({ length: 250 }, (_, i) => i);
    const b = planBatches(dates, 100, toNano("1000"), toNano("0.19"));
    expect(b.map((x) => x.length)).toEqual([100, 100, 50]);
    const small = planBatches(dates, 100, toNano("2"), toNano("0.19"));           // only 10 messages can be funded at once
    expect(small[0].length).toBe(10);
    expect(small.flat().length).toBe(250);
    expect(planBatches(dates, 4, toNano("1000"), toNano("0.19"))[0].length).toBe(4);   // a wallet that takes 4 per confirmation
    expect(planBatches(dates, 100, toNano("0.1"), toNano("0.19"))).toEqual([]);        // cannot fund even one
  });
  it("tells the real cost, not zero", () => {
    expect(estimate(100)).toEqual({ perToken: 0.15, total: 15, stays: 10 });
  });
});
