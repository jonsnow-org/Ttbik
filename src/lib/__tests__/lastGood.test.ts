import { keepLastGood, withinMs } from "@/lib/lastGood";

describe("market ticker last-good fallback", () => {
  it("fills null numbers from the previous good snapshot, per field", () => {
    const good = { goldUsd: 4000, btc: 90000, fx: [{ code: "TRY", rate: 41 }, { code: "SAR", rate: 3.75 }] };
    keepLastGood("t1", good);
    const next = keepLastGood("t1", { goldUsd: null, btc: 91000, fx: [{ code: "TRY", rate: null }, { code: "SAR", rate: 3.75 }] });
    expect(next.goldUsd).toBe(4000);       // missing now, kept
    expect(next.btc).toBe(91000);          // fresh value wins
    expect(next.fx[0].rate).toBe(41);      // row value kept
    expect(next.fx[1].rate).toBe(3.75);
  });
  it("does not use a snapshot older than the limit, and never invents a value", () => {
    keepLastGood("t2", { goldUsd: 4000 }, 1000, 0);
    expect(keepLastGood("t2", { goldUsd: null }, 1000, 5000).goldUsd).toBeNull();
    expect(keepLastGood("t3-never-seen", { goldUsd: null }).goldUsd).toBeNull();
  });
  it("does not store an all-empty snapshot as 'good'", () => {
    keepLastGood("t4", { goldUsd: 10 });
    keepLastGood("t4", { goldUsd: null });           // empty result must not overwrite the good one
    expect(keepLastGood("t4", { goldUsd: null }).goldUsd).toBe(10);
  });
  it("a slow provider is cut off instead of holding the page", async () => {
    expect(await withinMs(new Promise((r) => setTimeout(() => r("late"), 200)), 20)).toBeNull();
    expect(await withinMs(Promise.resolve("ok"), 200)).toBe("ok");
    expect(await withinMs(Promise.reject(new Error("x")), 200)).toBeNull();
  });
});

import { peggedRates, USD_PEGS } from "@/lib/ecbRates";
describe("pegged currencies on /prices", () => {
  const snap = { date: "2026-10-19", sourceName: "x", sourceUrl: "x", fetchedAtIso: "x", rates: [{ currency: "USD", nameAr: "x", perEuro: 1.16 }] };
  it("derives euro prices from the ECB EUR/USD and the official peg, nothing else", () => {
    const sar = peggedRates(snap).find((r) => r.currency === "SAR")!;
    expect(sar.perEuro).toBeCloseTo(1.16 * 3.75, 4);
    expect(peggedRates(snap)).toHaveLength(USD_PEGS.length);
  });
  it("shows nothing when the source has no USD row, and never lists a floating currency", () => {
    expect(peggedRates(null)).toEqual([]);
    expect(peggedRates({ ...snap, rates: [] })).toEqual([]);
    expect(USD_PEGS.map((p) => p.currency)).not.toContain("EGP");
  });
});
