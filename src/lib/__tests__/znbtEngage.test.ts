jest.mock("@/lib/prisma", () => ({ prisma: {} }));
jest.mock("@/lib/hostingOps", () => ({ HOSTING: { gateUrl: "https://x.test" } }));
jest.mock("@/lib/znbtIndex", () => ({ ensureIndexTables: async () => undefined }));
import { isAlertKind, isReaction, priceRatio, progressPct } from "@/lib/znbtEngage";

describe("znbtEngage helpers", () => {
  it("accepts only known reactions and alert kinds", () => {
    expect(isReaction("fire")).toBe(true);
    expect(isReaction("like")).toBe(false);
    expect(isAlertKind("near")).toBe(true);
    expect(isAlertKind("pump")).toBe(false);
  });
  it("price ratio is base_tpt / now_tpt (fewer tokens per TON = higher price)", () => {
    expect(priceRatio("1000", "800")).toBeCloseTo(1.25);
    expect(priceRatio("1000", "1250")).toBeCloseTo(0.8);
    expect(priceRatio("0", "5")).toBeNull();
    expect(priceRatio("abc", "5")).toBeNull();
  });
  it("progress percent from raised/threshold", () => {
    const c: any = { raisedNano: "900", thresholdNano: "1000" };
    expect(progressPct(c)).toBe(90);
    expect(progressPct({} as any)).toBeNull();
  });
});
