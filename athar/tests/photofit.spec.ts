// How a photo fits the circle: empty bars are cut, the person fills the circle, the window can be moved.
import { coverCrop, trimBorders } from "../web/lib/photoFit";
import { photoBox } from "../web/lib/art";

const grid = (w: number, h: number, f: (x: number, y: number) => number) => Uint8Array.from({ length: w * h }, (_, i) => f(i % w, Math.floor(i / w)));

describe("empty bars", () => {
  it("cuts black bars above and below (a letterboxed phone photo)", () => {
    const w = 100, h = 160;
    const lum = grid(w, h, (x, y) => (y < 30 || y >= 130 ? 2 : 120 + ((x * 7 + y * 3) % 90)));
    const t = trimBorders(lum, w, h);
    expect(t.top).toBe(30); expect(t.bottom).toBe(30); expect(t.left).toBe(0); expect(t.right).toBe(0);
  });
  it("cuts black bars at the sides, and white margins", () => {
    const side = trimBorders(grid(160, 100, (x, y) => (x < 20 || x >= 140 ? 0 : 100 + ((x + y) % 80))), 160, 100);
    expect(side.left).toBe(20); expect(side.right).toBe(20);
    const white = trimBorders(grid(100, 100, (x, y) => (y < 10 ? 255 : 90 + ((x + y) % 100))), 100, 100);
    expect(white.top).toBe(10);
  });
  it("leaves a real photo alone, even a dark one or one with a dark corner", () => {
    const dark = trimBorders(grid(100, 100, (x, y) => 60 + ((x * 5 + y * 11) % 120)), 100, 100);
    expect(dark).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
    const corner = trimBorders(grid(100, 100, (x, y) => (x < 8 && y < 8 ? 0 : 60 + ((x * 5 + y * 11) % 120))), 100, 100);
    expect(corner).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });
  it("never eats more than 40% of a side", () => {
    expect(trimBorders(grid(100, 100, () => 0), 100, 100).top).toBeLessThanOrEqual(40);
  });
});

describe("filling the circle", () => {
  it("takes a square window; portrait photos are cut a little above the middle by default (faces)", () => {
    expect(coverCrop(400, 800)).toEqual({ sx: 0, sy: Math.round(400 * 0.32), side: 400 });
    expect(coverCrop(800, 400)).toEqual({ sx: 200, sy: 0, side: 400 });
    expect(coverCrop(500, 500)).toEqual({ sx: 0, sy: 0, side: 500 });
  });
  it("the window can be moved along the long side and never leaves the picture", () => {
    expect(coverCrop(400, 800, 0.5, 0)).toMatchObject({ sy: 0 });
    expect(coverCrop(400, 800, 0.5, 1)).toMatchObject({ sy: 400 });
    expect(coverCrop(400, 800, 0.5, 5)).toMatchObject({ sy: 400 });
  });
  it("a square photo fills the whole circle; a very tall one still fits its long side", () => {
    const sq = photoBox(500, 500, 237);
    expect(sq.iw).toBeGreaterThanOrEqual(2 * 237 - 1);
    const tall = photoBox(300, 900, 237);
    expect(tall.ih).toBeGreaterThan(2 * 237);
  });
});
