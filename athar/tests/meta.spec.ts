import { hijriLabel, rarityReason, tierSupply, tokenStory } from "../web/lib/meta";
import { TOTAL_DATES, ruleTier } from "../web/lib/dates";
import { SEASON_1, seasonSize } from "../web/lib/seasons";
import { renderArt } from "../web/lib/art";
import { liveArt, storedMotion } from "../web/lib/live";

describe("what a buyer sees", () => {
  it("season supply adds up to the season size", () => {
    const s = tierSupply(1);
    expect(s[0] + s[1] + s[2]).toBe(seasonSize(SEASON_1));
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
