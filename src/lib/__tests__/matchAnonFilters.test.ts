import { anonPairOk, activeFilterFor, describeAnonFilter } from "@/lib/match/anonRules";
import { ANON_FILTERS_DAYS, PRICE_ANON_FILTERS, PRICE_VIP_30D, UPGRADE_CATALOGUE, extendAnonFilters, hasAnonFilters } from "@/lib/match/entitlementRules";

const F25 = { gender: "FEMALE", age: 25, country: "مصر" };
const M30 = { gender: "MALE", age: 30, country: "السعودية" };
const M50 = { gender: "MALE", age: 50, country: "مصر" };
const side = (profile: any, filter: any = null) => ({ profile, filter });

describe("anon pairing rules", () => {
  it("unfiltered users pair with anyone (incl. no profile), like the bot", () => {
    expect(anonPairOk(side(M30), side(F25))).toBe(true);
    expect(anonPairOk(side(null), side(null))).toBe(true);
  });
  it("a filtered user only pairs with partners satisfying the filter", () => {
    const f = { gender: "FEMALE" as const, ageMin: 20, ageMax: 30 };
    expect(anonPairOk(side(M30, f), side(F25))).toBe(true);
    expect(anonPairOk(side(M30, f), side(M50))).toBe(false);
    expect(anonPairOk(side(M30, f), side(null))).toBe(false); // no profile can't satisfy a filter
  });
  it("an unfiltered user never breaks a filtered user's constraints (both directions)", () => {
    const f = { country: "مصر" };
    expect(anonPairOk(side(M30), side(F25, { gender: "MALE" as const, ...f }))).toBe(false); // M30 is not in Egypt
    expect(anonPairOk(side(F25, { gender: "MALE" as const, ...f }), side(M30))).toBe(false);
    expect(anonPairOk(side(M50), side(F25, { gender: "MALE" as const, ...f }))).toBe(true);
  });
  it("when both are filtered, each must satisfy the other", () => {
    const wantsF = { gender: "FEMALE" as const };
    const wantsYoung = { ageMax: 35 };
    expect(anonPairOk(side(M30, wantsF), side(F25, wantsYoung))).toBe(true);
    expect(anonPairOk(side(M50, wantsF), side(F25, wantsYoung))).toBe(false);
    expect(anonPairOk(side(M30, { gender: "MALE" as const }), side(F25, wantsYoung))).toBe(false);
  });
  it("filter applies only to the queue row it was snapshotted on, and only while entitled", () => {
    const row = { filter: { gender: "FEMALE" as const }, paid_until: null, active_queue_id: "q1" };
    expect(activeFilterFor(row, "q1")).toEqual({ gender: "FEMALE" });
    expect(activeFilterFor(row, "q2")).toBeNull();
    expect(activeFilterFor(row, "q1", false)).toBeNull(); // expired mid-queue → not applied
    expect(activeFilterFor({ ...row, filter: {} }, "q1")).toBeNull();
    expect(activeFilterFor(null, "q1")).toBeNull();
  });
  it("describes filters for the timeout notice", () => {
    expect(describeAnonFilter(null)).toBe("بدون فلاتر");
    expect(describeAnonFilter({ gender: "MALE", ageMin: 26, ageMax: 35 })).toContain("ذكر");
  });
});

describe("anon filters entitlement", () => {
  const now = new Date("2026-10-14T10:00:00Z");
  const later = new Date("2026-10-20T10:00:00Z");
  const before = new Date("2026-10-01T10:00:00Z");
  it("is $2 / 30 days, cheaper than gold, listed in the catalogue", () => {
    expect(PRICE_ANON_FILTERS).toBe(2);
    expect(ANON_FILTERS_DAYS).toBe(30);
    expect(PRICE_ANON_FILTERS).toBeLessThan(PRICE_VIP_30D);
    expect(UPGRADE_CATALOGUE.some((c) => c.key === "anonFilters" && c.price === 2)).toBe(true);
  });
  it("is included in gold and expires without renewal", () => {
    expect(hasAnonFilters({ vipUntil: later }, null, now)).toBe(true);
    expect(hasAnonFilters({ vipUntil: null }, later, now)).toBe(true);
    expect(hasAnonFilters({ vipUntil: null }, before, now)).toBe(false);
    expect(hasAnonFilters({ vipUntil: before }, null, now)).toBe(false);
  });
  it("stacks a new purchase on remaining time", () => {
    expect(extendAnonFilters(null, now).getTime()).toBe(now.getTime() + 30 * 86400_000);
    expect(extendAnonFilters(later, now).getTime()).toBe(later.getTime() + 30 * 86400_000);
    expect(extendAnonFilters(before, now).getTime()).toBe(now.getTime() + 30 * 86400_000);
  });
});
