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
    expect(svg).toContain('class="ar-bd" transform="translate(166 604)"');
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
