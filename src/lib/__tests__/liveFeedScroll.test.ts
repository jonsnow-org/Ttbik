import { isNearBottom, resolveScroller } from "@/app/coder-app/_tma/scroll";

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

  // When the whole page (not an inner box) scrolls — the Telegram webview case — the hook used to find no scroll
  // parent, attach no listener, and leave `stick` true forever, so every live update yanked a reader who had
  // scrolled up. resolveScroller must fall back to the document scroller and listen on the window.
  it("falls back to the page scroller and listens on the window when the feed has no scroll parent", () => {
    const doc = { scrollingElement: { scrollTop: 0 }, documentElement: {}, defaultView: {} } as unknown as Document;
    const el = { parentElement: null, ownerDocument: doc } as unknown as HTMLElement;
    const { scroller, target } = resolveScroller(el);
    expect(scroller).toBe(doc.scrollingElement);
    expect(target).toBe(doc.defaultView);
  });

  it("prefers a real scroll parent over the page", () => {
    const inner = { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 };
    const doc = { scrollingElement: { scrollTop: 0 }, documentElement: {}, defaultView: {} } as unknown as Document;
    const parent = { parentElement: null, ownerDocument: doc } as unknown as HTMLElement;
    const el = { parentElement: parent, ownerDocument: doc } as unknown as HTMLElement;
    // scrollParent needs computed styles; stub the module's getComputedStyle for this branch.
    const original = globalThis.getComputedStyle;
    (globalThis as any).getComputedStyle = () => ({ overflowY: "scroll" });
    Object.defineProperty(parent, "scrollHeight", { value: inner.scrollHeight });
    Object.defineProperty(parent, "clientHeight", { value: inner.clientHeight });
    try {
      const resolved = resolveScroller(el);
      expect(resolved.scroller).toBe(parent);
      expect(resolved.target).toBe(parent);
    } finally {
      (globalThis as any).getComputedStyle = original;
    }
  });
});
