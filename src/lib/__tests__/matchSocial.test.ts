import { CARD_GENDER_DAYS, DM_FREE_PER_SIDE, PRICE_ANON_FILTERS, PRICE_CARD_GENDER, PRICE_DM_UNLOCK, dmAllowed, hasCardGenderFilter, DISCOUNTABLE_TYPES } from "@/lib/match/entitlementRules";

describe("round 4 rules", () => {
  it("card gender filter: same price as anon filters, 30 days, VIP included, discountable", () => {
    expect(PRICE_CARD_GENDER).toBe(PRICE_ANON_FILTERS);
    expect(CARD_GENDER_DAYS).toBe(30);
    const now = new Date();
    expect(hasCardGenderFilter({ vipUntil: null }, null, now)).toBe(false);
    expect(hasCardGenderFilter({ vipUntil: new Date(now.getTime() + 1000) }, null, now)).toBe(true);
    expect(hasCardGenderFilter({ vipUntil: null }, new Date(now.getTime() + 1000), now)).toBe(true);
    expect(hasCardGenderFilter({ vipUntil: null }, new Date(now.getTime() - 1000), now)).toBe(false);
    expect((DISCOUNTABLE_TYPES as readonly string[]).includes("CARD_GENDER_FILTER")).toBe(true);
  });
  it("stranger DMs: 3 free per side, then unlock/VIP; matches always free", () => {
    expect(DM_FREE_PER_SIDE).toBe(3);
    expect(PRICE_DM_UNLOCK).toBe(1);
    const base = { matched: false, unlocked: false, vip: false };
    expect(dmAllowed({ ...base, sentByMe: 2 })).toBe(true);
    expect(dmAllowed({ ...base, sentByMe: 3 })).toBe(false);
    expect(dmAllowed({ ...base, sentByMe: 9, unlocked: true })).toBe(true);
    expect(dmAllowed({ ...base, sentByMe: 9, vip: true })).toBe(true);
    expect(dmAllowed({ ...base, sentByMe: 50, matched: true })).toBe(true);
  });
});
