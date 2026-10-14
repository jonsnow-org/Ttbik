import { COMPLIMENTS, anonCandidateOk, anonFilterIsEmpty, complimentText, countryFlag, dayKey, onlineLabel, revealStep, sanitizeAnonFilter } from "@/lib/match/premium";
import * as premium from "@/lib/match/premium";
import {
  PRICE_ADVANCED_FILTERS, PRICE_BOOST_24H, PRICE_EXTRA_PHOTOS, PRICE_PROFILE_VISITORS, PRICE_SUPER_LIKE, PRICE_VERIFIED_BADGE, PRICE_VIP_30D, VIP_DAYS,
  UPGRADE_CATALOGUE, entitlementSummary, hasAdvancedFilters, hasExtraPhotos, hasProfileVisitors, isEffectivelyBoosted, isVipActive,
} from "@/lib/match/entitlementRules";

const now = new Date("2026-10-14T10:00:00Z");
const future = new Date(Date.now() + 86400_000);
const past = new Date(Date.now() - 86400_000);
const base = { vipUntil: null as Date | null, advancedFiltersUnlocked: false, profileVisitorsUnlocked: false, extraPhotosUnlocked: false, balance: 5 };

describe("bot pricing is the single source of truth", () => {
  it("keeps the bot's prices and durations", () => {
    expect([PRICE_BOOST_24H, PRICE_VERIFIED_BADGE, PRICE_EXTRA_PHOTOS, PRICE_PROFILE_VISITORS, PRICE_ADVANCED_FILTERS, PRICE_SUPER_LIKE, PRICE_VIP_30D, VIP_DAYS]).toEqual([2, 3, 2, 2, 2, 1, 8, 30]);
  });
  it("app catalogue mirrors the bot's upgrade buttons", () => {
    expect(UPGRADE_CATALOGUE.map((c) => [c.key, c.price])).toEqual([["boost", 2], ["verify", 3], ["photos", 2], ["visitors", 2], ["filters", 2], ["anonFilters", 2], ["vip", 8]]);
  });
  it("app grants nothing on its own (no spin / referral VIP / free quotas)", () => {
    for (const k of ["pickSpinPrize", "canSpin", "referralState", "countVerifiedReferrals", "compatibilityScore", "FREE_SUPERLIKES_PER_DAY", "FREE_ANON_CHATS_PER_DAY"]) expect((premium as any)[k]).toBeUndefined();
  });
});

describe("entitlements", () => {
  it("VIP implies the bundled features", () => {
    const vip = { ...base, vipUntil: future };
    expect(isVipActive(vip)).toBe(true);
    expect(hasAdvancedFilters(vip) && hasProfileVisitors(vip) && hasExtraPhotos(vip)).toBe(true);
    expect(isEffectivelyBoosted({ boostedUntil: null }, vip)).toBe(true);
  });
  it("expired VIP grants nothing, one-time unlocks persist", () => {
    const u = { ...base, vipUntil: past, profileVisitorsUnlocked: true };
    expect(isVipActive(u)).toBe(false);
    expect(hasProfileVisitors(u)).toBe(true);
    expect(hasAdvancedFilters(u)).toBe(false);
  });
  it("summary", () => {
    const s = entitlementSummary({ ...base }, { boostedUntil: new Date(now.getTime() + 3600_000), isIncognito: true, verificationStatus: "PENDING" }, now);
    expect(s).toMatchObject({ balance: 5, vip: false, boosted: true, incognitoAvailable: false, incognitoOn: false, verification: "PENDING", advancedFilters: false });
    expect(entitlementSummary({ ...base, vipUntil: new Date(now.getTime() + 1000) }, null, now)).toMatchObject({ vip: true, incognitoAvailable: true, boosted: true, extraPhotos: true });
  });
});

describe("reveal consent", () => {
  it("needs both sides", () => {
    expect(revealStep(null, "a")).toBe("first");
    expect(revealStep("a", "a")).toBe("waiting");
    expect(revealStep("a", "b")).toBe("mutual");
  });
});

describe("anon filters & misc", () => {
  it("sanitizes", () => {
    expect(sanitizeAnonFilter({ gender: "X", country: " ", ageMin: "15", ageMax: "abc" })).toEqual({ ageMin: 18 });
    expect(anonFilterIsEmpty(sanitizeAnonFilter({}))).toBe(true);
  });
  it("candidate matching", () => {
    expect(anonCandidateOk(null, {})).toBe(true);
    expect(anonCandidateOk(null, { gender: "FEMALE" })).toBe(false);
    expect(anonCandidateOk({ gender: "FEMALE", age: 17, country: "مصر" }, {})).toBe(false);
    expect(anonCandidateOk({ gender: "FEMALE", age: 25, country: "مصر" }, { gender: "FEMALE", country: "egypt", ageMin: 20, ageMax: 30 })).toBe(true);
  });
  it("compliments are preset only", () => {
    expect(complimentText(0)).toBe(COMPLIMENTS[0]);
    expect(complimentText(99)).toBeNull();
  });
  it("flags, presence, day key", () => {
    expect(countryFlag("saudi")).toBe("🇸🇦");
    expect(onlineLabel(new Date(1000), 1000 + 60_000).online).toBe(true);
    expect(dayKey(new Date("2026-10-14T22:30:00Z"))).toBe("2026-10-15");
  });
});
