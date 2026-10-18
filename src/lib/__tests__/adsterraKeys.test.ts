import { adsterraKeyFor, GATE_HOST } from "../adsterraKeys";

describe("Adsterra keys per address", () => {
  it("keeps the original keys on every other host", () => {
    expect(adsterraKeyFor("ttbik.vercel.app", "560a1eb1632771185b888243a7d36a07")).toBe("560a1eb1632771185b888243a7d36a07");
    expect(adsterraKeyFor("89-168-89-15.sslip.io", "x")).toBe("x");
  });
  it("maps the 320x50 and 300x250 units on the gate's host and shows nothing for 728x90", () => {
    expect(adsterraKeyFor(GATE_HOST, "560a1eb1632771185b888243a7d36a07")).toBe("8f7c8d3dde15b92944741daff182a498");
    expect(adsterraKeyFor(GATE_HOST, "3ee970813986977775e962f26938d143")).toBe("f729961b1e96c693ad1ade9f823959a4");
    expect(adsterraKeyFor(GATE_HOST, "4f06d38f318a4c96638f8e2289f8ca0c")).toBeNull();
  });
});
