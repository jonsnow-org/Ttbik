import { imageSize, fitWindow } from "../web/lib/imgsize";
import { renderPhotoArt } from "../web/lib/art";
import fs from "fs";
import os from "os";
import path from "path";

const JPG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAyAB4DASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnaKKK+1PRCiiigAooooAKKKKACiiigAooooAKKKKACiiigD//2Q==";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAABQAAAAKCAIAAAA7N+mxAAAAF0lEQVR4nGOssDnBQC5gIlvnqOYRoxkAoJMBkDIRPXYAAAAASUVORK5CYII=";
const WEBP = "UklGRkgAAABXRUJQVlA4IDwAAABQAwCdASooACgAPrVaqE8nJSOiI4gA4BaJZwDRvAtQqlHnwAD+54v/+4P6Yf6Yal+DLbYRC0C61+0AAAA=";
const WEBPL = "UklGRiQAAABXRUJQVlA4TBcAAAAvJAAPAAdQnuIVuf8BICH8Xy9G9D99AQA=";

describe("photo shape", () => {
  it("reads the real pixel size of JPEG, PNG and WebP (lossy and lossless)", () => {
    expect(imageSize(Buffer.from(JPG, "base64"))).toEqual({ w: 30, h: 50 });
    expect(imageSize(Buffer.from(PNG, "base64"))).toEqual({ w: 20, h: 10 });
    expect(imageSize(Buffer.from(WEBP, "base64"))).toEqual({ w: 40, h: 40 });
    expect(imageSize(Buffer.from(WEBPL, "base64"))).toEqual({ w: 37, h: 61 });
    expect(imageSize(Buffer.from("not an image"))).toBeNull();
  });
  it("the frame takes the photo's own shape: a face fills a big window, a standing figure a tall narrow one, nothing is cropped", () => {
    const face = fitWindow(600, 600), standing = fitWindow(400, 900), wide = fitWindow(1200, 600);
    expect(face.wh).toBeGreaterThan(500);
    expect(standing.ww).toBeLessThan(standing.wh / 2);
    expect(standing.wh).toBeGreaterThan(500);
    expect(wide.ww).toBeGreaterThan(wide.wh);
    for (const [w, h, r] of [[600, 600, face], [400, 900, standing], [1200, 600, wide]] as const) expect(Math.abs(r.ww / r.wh - w / h)).toBeLessThan(0.02);   // same aspect ratio
  });
  it("the composite uses that window", () => {
    const tall = renderPhotoArt({ index: 18300, tier: 0, season: 1, stage: 0, hands: 1, engravings: 0 }, "data:image/jpeg;base64," + JPG, { w: 400, h: 900 });
    const m = /<image id="ph"[^>]*width="(\d+)" height="(\d+)"/.exec(tall)!;
    const w = Number(m[1]), h = Number(m[2]);
    expect(w).toBeLessThan(300);
    expect(h).toBeGreaterThanOrEqual(474);                        // enlarged to fill (a little beyond) the circle's height
    expect(tall).toContain('scale(-1 1)');                        // the side space is painted by mirrored, softened copies of the photo, never black bars
    expect(tall).toContain('<circle cx="400" cy="400" r="392"');   // round token on a transparent square canvas
    expect(tall).not.toContain('<rect width="800"');
  });
});

describe("legal takedown list", () => {
  it("hides a token or a file, remembers why, and can restore", async () => {
    process.env.ATHAR_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "athar-"));
    jest.resetModules();
    const h = await import("../web/lib/hidden");
    const ref = "BVY30i8NUJdjkeQzI0wxl-VEaUHJCFJp6_tsPwuli4c";
    expect(h.isHiddenToken(18262)).toBe(false);
    h.hide("token", "18262", "court order 12/2026");
    h.hide("ref", ref, "case 77");
    expect(h.isHiddenToken(18262)).toBe(true);
    expect(h.isHiddenRef(ref)).toBe(true);
    expect(h.isHiddenToken(18263)).toBe(false);
    expect(h.listHidden().find((r) => r.key === "18262")!.note).toContain("court order");
    h.unhide("token", "18262");
    expect(h.isHiddenToken(18262)).toBe(false);
    expect(h.isHiddenRef(ref)).toBe(true);
  });
});

describe("waxed silver", () => {
  it("keeps the picture's structure (bright stays brighter than dark) and returns opaque pixels", async () => {
    const { waxPixels } = await import("../web/lib/wax");
    const W = 40, H = 40, d = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) { const v = (i % W) < W / 2 ? 30 : 220; d.set([v, v, v, 255], i * 4); }
    for (const mode of ["silver", "gold"] as const) {
      const o = waxPixels(d, W, H, mode);
      const at = (x: number, y: number) => (o[(y * W + x) * 4] + o[(y * W + x) * 4 + 1] + o[(y * W + x) * 4 + 2]) / 3;
      expect(at(30, 20)).toBeGreaterThan(at(10, 20));
      expect(o[3]).toBe(255);
    }
  });
});
