import { isNearBottom } from "@/app/coder-app/_tma/scroll";

// The live task feed must not yank the view upward while the reader is reading (owner's complaint: the screen jumps
// up inside the chat during real-time responses). The rule is: follow the tail only when the reader is already at the
// bottom; a reader who scrolled up stays put.
describe("live-feed stick-to-bottom", () => {
  const box = (scrollTop: number, scrollHeight = 1000, clientHeight = 400) => ({ scrollTop, scrollHeight, clientHeight });

  it("treats the very bottom as 'following'", () => {
    expect(isNearBottom(box(600))).toBe(true);              // 1000 - 600 - 400 = 0
  });

  it("still follows within the threshold (a few px of rounding / momentum)", () => {
    expect(isNearBottom(box(560))).toBe(true);              // 40 px from the bottom
    expect(isNearBottom(box(520))).toBe(true);              // exactly 80 px
  });

  it("stops following once the reader has scrolled up", () => {
    expect(isNearBottom(box(400))).toBe(false);             // 200 px above the bottom
    expect(isNearBottom(box(0))).toBe(false);               // reading from the top
  });

  it("a long answer that grows the feed does not re-stick a reader who left the bottom", () => {
    const readUp = box(300, 2000, 400);                     // grew to 2000, reader still at 300: far from the bottom
    expect(isNearBottom(readUp)).toBe(false);
  });
});
