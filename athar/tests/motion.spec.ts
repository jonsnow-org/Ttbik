import { renderArt } from "../web/lib/art";
import { liveArt, storedMotion } from "../web/lib/live";

// Sparks must stay where they are placed while they animate: a CSS animation on `transform` replaces the transform ATTRIBUTE,
// so the animated element may not carry its own placement (it once threw every spark to the picture's corner).
const base = { season: 1, stage: 2, hands: 3, engravings: 0 };
describe("token motion", () => {
  for (const [name, tier, index] of [["common", 0, 19000], ["rare", 1, 19002], ["mythic", 2, 19001]] as const) {
    it(`${name}: sparks are placed by their parent, the inner circle breathes and scatters light`, () => {
      const svg = liveArt(renderArt({ index, tier, ...base }), { stage: 2, tier });
      const animated = svg.match(/<path class="ar-(?:tw|sc)"[^>]*>/g) || [];
      expect(animated.length).toBeGreaterThan(8);
      for (const p of animated) expect(p).not.toMatch(/\btransform=/);
      expect(svg).toContain('class="ar-sc"');
      expect(svg).toContain("@keyframes ar-scat");
      if (tier !== 1) expect(svg).toContain('class="ar-rb"');       // the rosette contracts and brightens; the rare crystal has its own pulse
    });
  }
  it("the stored shimmer keeps the inner scatter too", () => {
    expect(storedMotion(renderArt({ index: 19001, tier: 2, ...base }))).toContain('class="ar-sc"');
  });
});
