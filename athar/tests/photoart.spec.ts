// A token that carries a photo: it must always fit the free permanent storage, keep its own rosette as a small badge, and move.
import { renderPhotoArt, renderArt } from "../web/lib/art";
import { badgeMotion, storedMotion } from "../web/lib/live";
import { PHOTO_BUDGET } from "../web/lib/photo";
import { MAX_BYTES } from "../web/lib/storage";

const photo = (raw: number) => "data:image/jpeg;base64," + "A".repeat(Math.ceil((raw * 4) / 3));
const art = (tier: number, occasion = 0) => ({ index: 19000 + tier, tier, season: 1, stage: 0, hands: 1, engravings: 0, occasion });

describe("photo token", () => {
  it.each([0, 1, 2])("the largest allowed photo still fits free storage (tier %i, with an occasion)", (tier) => {
    const svg = renderPhotoArt(art(tier, 3), photo(PHOTO_BUDGET), { w: 800, h: 800 });
    const stored = tier === 2 ? storedMotion(svg) : badgeMotion(svg);
    expect(Buffer.byteLength(stored)).toBeLessThanOrEqual(MAX_BYTES);
  });
  it("keeps the date's rosette as a turning, breathing badge at the bottom left; the photo is stored once", () => {
    const svg = badgeMotion(renderPhotoArt(art(0), photo(1000), { w: 400, h: 500 }));
    expect(svg).toContain('class="ar-bd" transform="translate(166 580)"');
    expect(svg).toContain("ar-spin");
    expect((svg.match(/data:image\/jpeg/g) || []).length).toBe(1);
  });
  it("a token with no photo keeps the rosette in the middle", () => {
    expect(renderArt(art(0))).not.toContain("ar-bd");
  });
  it("gold special dates tell the truth about their rarity", () => {
    const svg = renderPhotoArt({ ...art(1), gold: true }, photo(1000), { w: 400, h: 400 });
    expect(svg).toContain("RARE · S1");
    expect(svg).toContain("#ffd36a");
  });
});

describe("the three tiers are told apart", () => {
  const a = (tier: number) => renderArt({ index: 19000 + tier, tier, season: 1, stage: 0, hands: 1, engravings: 0 });
  it("rare has its own crystal and its own colours, neither the guilloche nor the gold", () => {
    const common = a(0), rare = a(1), mythic = a(2);
    expect(rare).toContain("ar-c1");
    expect(rare).toContain("#5ff0cf");
    expect(common).not.toContain("ar-c1");
    expect(common).not.toContain("#5ff0cf");
    expect(mythic).not.toContain("#5ff0cf");
    expect(mythic).toContain("#ffd36a");
  });
  it("every stored version moves (crystal, badge, photo light)", () => {
    const css = badgeMotion(renderArt({ index: 19001, tier: 1, season: 1, stage: 0, hands: 1, engravings: 0 }));
    for (const k of ["ar-c1", "ar-c2", "ar-c3", "ar-cg", "ar-bdp", "ar-pgs"]) expect(css).toContain(k);
  });
  it("a rare photo token keeps a crystal badge", () => {
    const svg = renderPhotoArt(art(1), photo(1000), { w: 400, h: 500 });
    expect(svg).toContain('class="ar-bd"');
    expect(svg).toContain("ar-c1");
  });
});

describe("the age of a token is visible", () => {
  const at = (stage: number) => renderArt({ index: 19000, tier: 0, season: 1, stage, hands: 1, engravings: 0 });
  it("each stage adds a mark and keeps the earlier ones", () => {
    expect(at(0)).not.toContain("ar-sta");
    expect(at(2)).toContain("ar-sta");
    expect(at(2)).not.toContain("ar-st3");
    expect(at(3)).toContain("ar-st3");
    expect(at(3)).not.toContain("ar-st4");
    expect(at(4)).toContain("ar-st4");
    expect(at(4)).toContain("ar-st3");
    expect(at(4)).toContain("ar-stb");
  });
});

describe("gold-wax tokens", () => {
  it("keep a gold badge and a gold frame whatever the date's rarity", () => {
    const svg = renderPhotoArt({ index: 18900, tier: 0, season: 1, stage: 0, hands: 1, engravings: 0, gold: true }, photo(1000), { w: 400, h: 400 });
    expect(svg).toContain("#ffd25a");           // the gold guilloche of the badge
    expect(svg).toContain("COMMON · S1");       // the rarity text stays true
  });
});
