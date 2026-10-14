import {
  COMPLIMENTS, SPIN_PRIZES, anonCandidateOk, anonFilterIsEmpty, canSpin, compatibilityScore, complimentText, countVerifiedReferrals,
  countryFlag, dayKey, onlineLabel, pickSpinPrize, referralState, revealStep, sanitizeAnonFilter,
} from "@/lib/match/premium";

const cand = { gender: "FEMALE", age: 27, country: "مصر", city: "القاهرة", job: "طبيبة", education: "جامعي", maritalStatus: "عزباء", attributes: "هادئة ومتدينة" };
const viewer = { gender: "MALE", age: 30, country: "مصر" };

describe("compatibility (deterministic)", () => {
  it("same inputs -> same score, within 35..99", () => {
    const pref = { country: "مصر", ageMin: 24, ageMax: 30, job: "طبيبة" };
    const a = compatibilityScore(cand, pref, viewer, { country: "مصر", ageMin: 28, ageMax: 35 });
    expect(a).toBe(compatibilityScore(cand, pref, viewer, { country: "مصر", ageMin: 28, ageMax: 35 }));
    expect(a).toBeGreaterThanOrEqual(35);
    expect(a).toBeLessThanOrEqual(99);
  });
  it("better fit scores higher", () => {
    const good = compatibilityScore(cand, { country: "مصر", ageMin: 25, ageMax: 30 }, viewer, null);
    const bad = compatibilityScore(cand, { country: "السعودية", ageMin: 40, ageMax: 50 }, viewer, null);
    expect(good).toBeGreaterThan(bad);
  });
  it("country aliases count as same", () => {
    expect(compatibilityScore(cand, { country: "egypt" }, viewer, null)).toBe(compatibilityScore(cand, { country: "مصر" }, viewer, null));
  });
  it("null pref still works", () => expect(compatibilityScore(cand, null)).toBeGreaterThanOrEqual(35));
});

describe("spin wheel", () => {
  it("maps randomness to weighted prizes", () => {
    expect(pickSpinPrize(0).prize.key).toBe("superlike2");
    expect(pickSpinPrize(0.999999).prize.key).toBe("vip1d");
    expect(pickSpinPrize(-5).index).toBe(0);
    expect(pickSpinPrize(5).prize.key).toBe("vip1d");
  });
  it("distribution roughly follows weights", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 10000; i++) { const k = pickSpinPrize(i / 10000).prize.key; counts[k] = (counts[k] || 0) + 1; }
    const total = SPIN_PRIZES.reduce((s, p) => s + p.weight, 0);
    for (const p of SPIN_PRIZES) expect(Math.abs(counts[p.key] / 10000 - p.weight / total)).toBeLessThan(0.01);
  });
  it("once per day", () => { expect(canSpin(0)).toBe(true); expect(canSpin(1)).toBe(false); });
  it("day key uses UTC+3", () => expect(dayKey(new Date("2026-10-14T22:30:00Z"))).toBe("2026-10-15"));
});

describe("referral anti-abuse", () => {
  const refs = [
    { phoneVerified: true, isBanned: false, profileStatus: "APPROVED" },
    { phoneVerified: false, isBanned: false, profileStatus: "APPROVED" },
    { phoneVerified: true, isBanned: true, profileStatus: "APPROVED" },
    { phoneVerified: true, isBanned: false, profileStatus: "PENDING" },
    { phoneVerified: true, isBanned: false, profileStatus: null },
    { phoneVerified: true, isBanned: false, profileStatus: "APPROVED" },
  ];
  it("counts only verified approved non-banned", () => expect(countVerifiedReferrals(refs)).toBe(2));
  it("claim gate", () => {
    expect(referralState(2, false).canClaim).toBe(false);
    expect(referralState(3, false).canClaim).toBe(true);
    expect(referralState(5, true).canClaim).toBe(false);
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
    expect(anonCandidateOk({ gender: "FEMALE", age: 35, country: "مصر" }, { ageMax: 30 })).toBe(false);
  });
  it("compliments are preset only", () => {
    expect(complimentText(0)).toBe(COMPLIMENTS[0]);
    expect(complimentText(99)).toBeNull();
    expect(complimentText(1.5)).toBeNull();
  });
  it("flags & presence", () => {
    expect(countryFlag("saudi")).toBe("🇸🇦");
    expect(countryFlag("Atlantis")).toBe("🌍");
    expect(onlineLabel(new Date(1000), 1000 + 60_000).online).toBe(true);
    expect(onlineLabel(new Date(0), 3 * 3600_000).label).toBe("قبل 3 س");
  });
});
