import { PROJECT_PROMOS, CYCLE, pickPromoKind, rotate } from "../channelPromos";
import { isSafeForChannel } from "../channelPublisher";

jest.mock("@/lib/groq", () => ({ callGroq: async () => "" }));
jest.mock("@/lib/supabase", () => ({ supabasePublic: () => ({}) }));
jest.mock("@/lib/prisma", () => ({ prisma: {} }));

describe("channel promo rotation", () => {
  it("every fixed project post passes the channel's safety filter and promises nothing", () => {
    for (const p of PROJECT_PROMOS) {
      expect(isSafeForChannel(p.text)).toBe(true);
      expect(p.text).not.toMatch(/guarantee|ضمان|مضمون|will (rise|go up)|سيرتفع/i);
    }
  });
  it("every project in the cycle has a fixed post (or is one of the three pools)", () => {
    const ids = new Set(PROJECT_PROMOS.map((p) => p.id));
    for (const k of CYCLE) expect(ids.has(k) || ["free", "bot", "service"].includes(k)).toBe(true);
  });
  it("is deterministic and visits every kind within one cycle (4 days)", () => {
    const d = new Date("2026-12-01T10:00:00Z");
    expect(pickPromoKind(d, 2)).toEqual(pickPromoKind(new Date("2026-12-01T20:00:00Z"), 2));
    const seen = new Set<string>();
    for (let i = 0; i < CYCLE.length; i++) {
      const day = new Date(d.getTime() + Math.floor(i / 3) * 86400000);
      seen.add(pickPromoKind(day, (i % 3) + 1).kind);
    }
    expect(seen).toEqual(new Set(CYCLE));
  });
  it("the Zenobia and Athar posts come round every day or two", () => {
    const d = new Date("2026-12-01T00:00:00Z");
    const kinds: string[] = [];
    for (let i = 0; i < 6; i++) kinds.push(pickPromoKind(new Date(d.getTime() + Math.floor(i / 3) * 86400000), (i % 3) + 1).kind);
    expect(kinds.some((k) => k.startsWith("zenobia"))).toBe(true);
    expect(kinds.some((k) => k.startsWith("athar"))).toBe(true);
  });
  it("rotates through a pool in order and wraps", () => {
    expect([0, 1, 2, 3].map((t) => rotate(["a", "b", "c"], t))).toEqual(["a", "b", "c", "a"]);
    expect(rotate([], 5)).toBeUndefined();
  });
});
