import { hijriLabel, rarityReason, kindSupply, tokenStory } from "../web/lib/meta";
import { TOTAL_DATES, ruleTier } from "../web/lib/dates";
import { SEASON_1, capOf } from "../web/lib/seasons";
import { renderArt } from "../web/lib/art";
import { liveArt, storedMotion } from "../web/lib/live";

describe("what a buyer sees", () => {
  it("every kind states its supply cap, and the caps only get smaller as the kinds get rarer", () => {
    for (let k = 0; k < 8; k++) expect(kindSupply(1, k)).toBe(capOf(SEASON_1, k));
    expect(kindSupply(1, 0)).toBeGreaterThan(kindSupply(1, 1));
    expect(kindSupply(1, 1)).toBeGreaterThan(kindSupply(1, 2));
    expect(kindSupply(1, 7)).toBeLessThan(kindSupply(1, 2));
  });
  it("every date has a reason that matches its rarity (never 'everyday' for a rare one)", () => {
    for (let i = 0; i < TOTAL_DATES; i += 7) {
      const t = ruleTier(i);
      const r = rarityReason(i, t, 99);   // season 99 = fallback to season 1 rules without specials noise
      expect(r.ar.length).toBeGreaterThan(3);
      if (t > 0) expect(r.en).not.toBe("an everyday date");
    }
  });
  it("hijri date is produced", () => { expect(hijriLabel(18262, "ar")).toMatch(/\d/); expect(hijriLabel(18262, "en").length).toBeGreaterThan(5); });
  it("story never talks about where a picture is kept", () => {
    const st = tokenStory(18262, { season: 1, tier: 2, hands: 3, engravings: 1, lastTransferAt: 1700000000, mintedAt: 1700000000, mediaRef: "5", occasion: 0 }, 2, 2, () => null);
    const all = st.description + JSON.stringify(st.attrs);
    expect(all).not.toMatch(/arweave|permanent|للأبد|دائم|stored/i);
    expect(st.attrs.some((a) => a.trait_type === "Days to next age stage")).toBe(true);
  });
  it("animation is added without scripts and the still picture is untouched", () => {
    const svg = renderArt({ index: 20000, tier: 1, season: 1, stage: 2, hands: 2, engravings: 0 });
    for (const out of [liveArt(svg, { stage: 2, tier: 1, anniversary: true }), storedMotion(svg)]) {
      expect(out).not.toMatch(/<script|onload|javascript:/i);
      expect(out.startsWith("<svg")).toBe(true);
      expect(out.endsWith("</svg>")).toBe(true);
    }
    expect(svg).not.toContain("@keyframes");
  });
});
