import { renderArt, renderPhotoArt } from "../web/lib/art";
import { idToUint256, arweaveId } from "../web/lib/ids";
import { OCCASIONS } from "../web/lib/occasions";

const jpeg = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
describe("token art", () => {
  it("every occasion draws and keeps the SVG well-formed", () => {
    for (const o of [0, ...OCCASIONS.map((x) => x.id)]) {
      const svg = renderArt({ index: 18262 + 100, tier: 1, season: 1, stage: 2, hands: 3, engravings: 1, occasion: o });
      expect(svg.startsWith("<svg")).toBe(true); expect(svg.trim().endsWith("</svg>")).toBe(true);
      expect((svg.match(/<g[ >]/g) || []).length).toBe((svg.match(/<\/g>/g) || []).length);
    }
  });
  it("a photo composite embeds the photo whole and stays far under the 100 KiB free limit", () => {
    const svg = renderPhotoArt({ index: 18262 + 5, tier: 2, season: 1, stage: 3, hands: 6, engravings: 2, occasion: 2 }, jpeg);
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');       // never cropped
    expect(svg).toContain(jpeg);
    expect(Buffer.byteLength(svg)).toBeLessThan(100 * 1024);
  });
  it("an Arweave id survives the round trip through the 256-bit number stored in the token", () => {
    const id = "BVY30i8NUJdjkeQzI0wxl-VEaUHJCFJp6_tsPwuli4c";
    expect(arweaveId(idToUint256(id))).toBe(id);
    expect(() => idToUint256("short")).toThrow();
  });
});
