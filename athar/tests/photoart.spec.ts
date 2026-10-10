// A token that carries a photo: it must always fit the free permanent storage, keep its own rosette as a small badge, and move.
import { renderPhotoArt, renderArt } from "../web/lib/art";
import { badgeMotion, liveArt } from "../web/lib/live";
import { PHOTO_BUDGET } from "../web/lib/photo";
import { MAX_BYTES } from "../web/lib/storage";

const photo = (raw: number) => "data:image/jpeg;base64," + "A".repeat(Math.ceil((raw * 4) / 3));
const art = (tier: number, occasion = 0) => ({ index: 19000 + tier, tier, season: 1, stage: 0, hands: 1, engravings: 0, occasion });

describe("photo token", () => {
  it.each([0, 1, 2, 3, 4, 5, 6, 7])("the largest allowed photo still fits free storage (kind %i, with an occasion)", (tier) => {
    const svg = renderPhotoArt(art(tier, 3), photo(PHOTO_BUDGET), { w: 800, h: 800 });
    const stored = liveArt(svg, { stage: 4, tier });        // what the purchase stores (the busiest version: the oldest age stage)
    expect(Buffer.byteLength(stored)).toBeLessThanOrEqual(MAX_BYTES);
  });
  it("keeps the date's rosette as a turning, breathing badge at the bottom left; the photo is stored once", () => {
    const svg = badgeMotion(renderPhotoArt(art(0), photo(1000), { w: 400, h: 500 }));
    expect(svg).toContain('class="ar-bd" transform="translate(98 400)"');
    expect(svg).toContain("ar-spin");
    expect((svg.match(/data:image\/jpeg/g) || []).length).toBe(1);
  });
  it("a token with no photo keeps the rosette in the middle", () => {
    expect(renderArt(art(0))).not.toContain("ar-bd");
  });
  it("a gold token's photo is framed in gold and says what it is", () => {
    const svg = renderPhotoArt(art(2), photo(1000), { w: 400, h: 400 });
    expect(svg).toContain("GOLD · S1");
    expect(svg).toContain("#ffd36a");
  });
});

describe("the kinds are told apart", () => {
  const a = (tier: number) => renderArt({ index: 19000 + tier, tier, season: 1, stage: 0, hands: 1, engravings: 0 });
  it("rare has its own crystal and its own colours, neither the guilloche nor the gold", () => {
    const common = a(0), rare = a(4), mythic = a(2);
    expect(rare).toContain("ar-c1");
    expect(rare).toContain("#5ff0cf");
    expect(common).not.toContain("ar-c1");
    expect(common).not.toContain("#5ff0cf");
    expect(mythic).not.toContain("#5ff0cf");
    expect(mythic).toContain("#ffd36a");
  });
  it("every stored version moves (crystal, badge, photo light)", () => {
    const css = badgeMotion(renderArt({ index: 19001, tier: 4, season: 1, stage: 0, hands: 1, engravings: 0 }));
    for (const k of ["ar-c1", "ar-c2", "ar-c3", "ar-cg", "ar-bdp", "ar-pgs"]) expect(css).toContain(k);
  });
  it("a rare photo token keeps a crystal badge", () => {
    const svg = renderPhotoArt(art(4), photo(1000), { w: 400, h: 500 });
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

describe("every kind has its own look", () => {
  const labels = ["NORMAL", "SILVER", "GOLD", "BRONZE", "RARE", "PURPLE", "DIAMOND", "LEGENDARY"];
  it("a different label, and a different set of colours, for each of the eight kinds", () => {
    const svgs = labels.map((_, k) => renderArt({ index: 19000, tier: k, season: 1, stage: 0, hands: 1, engravings: 0 }));
    svgs.forEach((svg, k) => expect(svg).toContain(`${labels[k]} · S1`));
    expect(new Set(svgs).size).toBe(8);
  });
  it("each kind's motion adds its own movement", () => {
    const live = (k: number) => liveArt(renderArt({ index: 19000, tier: k, season: 1, stage: 1, hands: 1, engravings: 0 }), { stage: 1, tier: k });
    expect(live(1)).toContain("ar-ksw");                    // silver: a glint passes
    expect(live(3)).toContain("ar-pat");                    // bronze: the patina
    expect(live(5)).toContain("ar-vgl");                    // purple: the royal glow
    expect(live(6)).toContain("ar-pr");                     // diamond: the prism
    expect(live(7)).toContain("ar-lr");                     // legendary: the crown of rays
    expect(live(0)).not.toContain("ar-ksw");
    for (let k = 0; k < 8; k++) expect(live(k)).not.toMatch(/<script|javascript:/i);
  });
});
