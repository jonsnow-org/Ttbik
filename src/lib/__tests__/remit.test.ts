import { crossRate, midRates, PROVIDERS, providerLink, quoteCost, verdict } from "@/lib/remit/remit";

const snap = { date: "2026-11-09", sourceName: "ECB", sourceUrl: "x", fetchedAtIso: "", rates: [{ currency: "USD", nameAr: "دولار", perEuro: 1.1 }, { currency: "TRY", nameAr: "ليرة", perEuro: 44 }] };

describe("remit comparison", () => {
  it("builds EUR + ECB + pegged rates and crosses them", () => {
    const r = midRates(snap);
    expect(r.map((x) => x.currency)).toEqual(expect.arrayContaining(["EUR", "USD", "TRY", "SAR", "AED"]));
    expect(crossRate(r, "USD", "TRY")).toBeCloseTo(40, 6);
    expect(crossRate(r, "USD", "SAR")).toBeCloseTo(3.75, 3);
    expect(crossRate(r, "USD", "EGP")).toBeNull();
    expect(midRates(null)).toEqual([]);
  });
  it("exposes the hidden rate margin of a 'zero fee' quote", () => {
    const c = quoteCost(100, 0, 3880, 40)!;
    expect(c.fair).toBe(4000);
    expect(c.marginPct).toBe(3);
    expect(c.costPct).toBe(3);
    expect(c.lostInSource).toBe(3);
    const f = quoteCost(100, 5, 4000, 40)!;
    expect(f.marginPct).toBe(0);
    expect(f.costPct).toBeCloseTo(4.76, 2);
    expect(quoteCost(0, 0, 1, 40)).toBeNull();
    expect(verdict(1).tone).toBe("good");
    expect(verdict(3).tone).toBe("ok");
    expect(verdict(6).tone).toBe("bad");
  });
  it("uses an https referral link only when the owner set one", () => {
    const wise = PROVIDERS.find((p) => p.key === "WISE")!;
    expect(providerLink(wise, {})).toEqual({ href: wise.url, sponsored: false });
    expect(providerLink(wise, { REMIT_REF_WISE: "https://wise.com/invite/abc" })).toEqual({ href: "https://wise.com/invite/abc", sponsored: true });
    expect(providerLink(wise, { REMIT_REF_WISE: "javascript:alert(1)" }).sponsored).toBe(false);
    for (const p of PROVIDERS) expect(p.url.startsWith("https://")).toBe(true);
  });
});
