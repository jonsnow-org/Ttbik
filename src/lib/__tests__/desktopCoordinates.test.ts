import { desktopPoint, screenSizeOf } from "@/lib/desktopCoordinates";

describe("desktop coordinate mapping", () => {
  // The live view streams a 0.75-scaled picture of a 1344×840 screen: the <img> is 1008×630.
  const rect = { left: 0, top: 0, width: 1008, height: 630 };
  const natural = { width: 1008, height: 630 };

  it("maps a click through the REAL screen size, not the scaled picture", () => {
    // The bottom-right pixel of the picture is the bottom-right of the SCREEN, not of the 1008×630 frame.
    expect(desktopPoint(rect, { clientX: 1008, clientY: 630 }, natural, { w: 1344, h: 840 })).toEqual({ x: 1344, y: 840 });
    // A quarter in lands at 336×210 on screen, not 252×158.
    expect(desktopPoint(rect, { clientX: 252, clientY: 158 }, natural, { w: 1344, h: 840 })).toEqual({ x: 336, y: 211 });
  });

  it("accounts for the element's offset on the page", () => {
    const offset = { left: 40, top: 12, width: 1008, height: 630 };
    expect(desktopPoint(offset, { clientX: 40, clientY: 12 }, natural, { w: 1344, h: 840 })).toEqual({ x: 0, y: 0 });
  });

  it("falls back to the natural size when the screen size is unknown (scale-1.0 poll)", () => {
    expect(desktopPoint(rect, { clientX: 500, clientY: 300 }, natural, null)).toEqual({ x: 500, y: 300 });
  });

  it("returns null when there is nothing to click yet", () => {
    expect(desktopPoint(rect, { clientX: 1, clientY: 1 }, { width: 0, height: 0 }, { w: 1344, h: 840 })).toBeNull();
    expect(desktopPoint({ left: 0, top: 0, width: 0, height: 0 }, { clientX: 1, clientY: 1 }, natural, null)).toBeNull();
  });
});

describe("screenSizeOf", () => {
  it("reads the real screen size from a frame / live event", () => {
    expect(screenSizeOf({ width: 1344, height: 840 })).toEqual({ w: 1344, h: 840 });
    expect(screenSizeOf({ width: "1344", height: "840" })).toEqual({ w: 1344, h: 840 });
  });
  it("is null when the size is missing or unusable", () => {
    expect(screenSizeOf({})).toBeNull();
    expect(screenSizeOf(null)).toBeNull();
    expect(screenSizeOf({ width: 0, height: 840 })).toBeNull();
    expect(screenSizeOf({ width: "x", height: 840 })).toBeNull();
  });
});
