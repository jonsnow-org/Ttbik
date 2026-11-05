import { computeSlice, makeLedger, MAX_MS, MIN_CORES, SESSION_CAP_MS } from "@/lib/clientCompute";

describe("client compute slice (a little, only with opt-in, only on a capable device)", () => {
  it("takes nothing without an explicit opt-in", () => {
    expect(computeSlice(false, { cores: 8, memoryGb: 8 })).toEqual({ allowed: false, workers: 0, maxMs: 0 });
  });

  it("leaves a weak device alone even with opt-in", () => {
    expect(computeSlice(true, { cores: MIN_CORES - 1, memoryGb: 8 }).allowed).toBe(false);
  });

  it("gives one worker and at most 1.5s on a capable device", () => {
    const s = computeSlice(true, { cores: 8, memoryGb: 8 });
    expect(s.allowed).toBe(true);
    expect(s.workers).toBe(1);
    expect(s.maxMs).toBe(MAX_MS);
    expect(s.maxMs).toBeLessThanOrEqual(1500);
  });

  it("never lets a session's small jobs add up past the cap", () => {
    const l = makeLedger(SESSION_CAP_MS);
    expect(l.spend(MAX_MS)).toBe(true);
    expect(l.spend(MAX_MS)).toBe(true);
    expect(l.spend(MAX_MS)).toBe(true);
    expect(l.spend(MAX_MS)).toBe(true);            // 6000 ms exactly
    expect(l.remaining()).toBe(0);
    expect(l.spend(1)).toBe(false);                // the next job is refused, not partially done
    expect(l.remaining()).toBe(0);                 // and the budget never goes negative
  });
});
