import { buildItem, contentKey, MAX_BYTES } from "../web/lib/storage";
import { arweaveId } from "../web/lib/ids";

describe("content-derived permanent storage", () => {
  it("gives the same id for the same picture, whoever builds it and whenever", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
    const a = await buildItem(svg), b = await buildItem(svg);
    expect(a.id).toBe(b.id);
    expect(a.ref).toBe(b.ref);
    expect(arweaveId(a.ref)).toBe(a.id);                  // the number kept in the token maps back to the id
    expect(a.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("gives another id for another picture, and the key is derived from the content only", async () => {
    const a = await buildItem("<svg xmlns='http://www.w3.org/2000/svg'><rect width='1' height='1'/></svg>");
    const b = await buildItem("<svg xmlns='http://www.w3.org/2000/svg'><rect width='2' height='1'/></svg>");
    expect(a.id).not.toBe(b.id);
    expect(await contentKey(new TextEncoder().encode("x"))).not.toBe(await contentKey(new TextEncoder().encode("y")));
  });
  it("refuses a file that cannot be stored for free", async () => {
    await expect(buildItem("<svg>" + "a".repeat(MAX_BYTES) + "</svg>")).rejects.toThrow();
  });
});

import { validateSvg } from "../web/lib/mediaQueue";
import { renderArt, renderPhotoArt } from "../web/lib/art";
import { specialScene } from "../web/lib/specialArt";
import { indexOf } from "../web/lib/dates";

describe("what the server accepts into its queue", () => {
  const a = { index: 18300, tier: 1, season: 1, stage: 1, hands: 2, engravings: 0 };
  const JPG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
  it("accepts our own composites, with or without a photo", () => {
    expect(validateSvg(renderArt(a))).toBeNull();
    expect(validateSvg(renderPhotoArt(a, JPG, { w: 400, h: 600 }))).toBeNull();
  });
  it("accepts nothing that could run code or load something from elsewhere", () => {
    expect(validateSvg('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')).not.toBeNull();
    expect(validateSvg('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"></svg>')).not.toBeNull();
    expect(validateSvg('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/a.png"/></svg>')).not.toBeNull();
    expect(validateSvg('<svg xmlns="http://www.w3.org/2000/svg"><foreignObject/></svg>')).not.toBeNull();
    expect(validateSvg("<html></html>")).not.toBeNull();
    expect(validateSvg(42)).not.toBeNull();
    expect(validateSvg("<svg>" + "x".repeat(200_000) + "</svg>")).not.toBeNull();
  });
  it("accepts the picture of a special date (scene is turned into a photo first, so it is the composite that matters)", () => {
    expect(specialScene(indexOf(2011, 3, 15))).not.toBeNull();
  });
});
