import { textPaths, textWidth } from "../web/lib/glyphs";
import { renderArt, renderPhotoArt } from "../web/lib/art";
import { renderSpecialLive } from "../web/lib/specialLive";
import { SEASON_1, } from "../web/lib/seasons";
import { specialIndex } from "../web/lib/seasons";

// Lettering is drawn as outlines: markets that rasterise our pictures on their own servers have no fonts and print empty boxes for <text>.
describe("lettering as outlines", () => {
  it("draws letters, digits, the engraving mark and the Arabic header word", () => {
    const g = textPaths("ATHAR · أثر", { x: 400, y: 86, size: 24, anchor: "middle", spacing: 10, fill: "#fff" });
    expect(g).toContain('data-t="ATHAR · أثر"');
    expect((g.match(/<path /g) || []).length).toBe(5 + 1 + 3);     // A T H A R, ·, and the three joined forms of أثر (spaces draw nothing)
    expect(textPaths("✎2", { x: 0, y: 0, size: 20, fill: "#fff" })).toContain("<path");
  });
  it("centres on its width and is wider with letter-spacing", () => {
    const w0 = textWidth("EDITION I", 13), w1 = textWidth("EDITION I", 13, "sans", 5);
    expect(w1).toBeGreaterThan(w0 + 5 * 7);
    expect(textPaths("A", { x: 100, y: 0, size: 100, anchor: "middle", fill: "#000" })).toContain("translate(66.65 0)");   // 100 - 667/1000*100/2
  });
  it("unknown characters become a question mark, never a missing glyph or a crash", () => {
    expect(() => textPaths("日本", { x: 0, y: 0, size: 10, fill: "#000" })).not.toThrow();
  });
  it("no picture carries <text>: ordinary, sealed, photo and special", () => {
    const base = { season: 1, stage: 1, hands: 2, engravings: 1 };
    const pics = [
      renderArt({ index: 19000, tier: 0, ...base }), renderArt({ index: 19001, tier: 1, ...base, engravings: 0 }), renderArt({ index: 19002, tier: 2, ...base }),
      renderArt({ index: 19003, tier: 0, ...base, sealed: true }),
      renderPhotoArt({ index: 19004, tier: 0, ...base }, "data:image/jpeg;base64,AAAA", { w: 400, h: 400 }),
    ];
    for (const s of pics) { expect(s).not.toContain("<text"); expect(s).toContain("data-t="); }
    let n = 0;
    for (const d of SEASON_1.specials) { const sp = renderSpecialLive(specialIndex(d)); if (sp) { n++; expect(sp).not.toContain("<text"); } }
    expect(n).toBeGreaterThan(40);                         // the special dates' drawings carry their small printed word as outlines too
  });
});
