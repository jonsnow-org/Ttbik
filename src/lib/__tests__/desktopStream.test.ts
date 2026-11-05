import { desktopStreamMode } from "@/lib/desktopStream";

describe("desktopStreamMode", () => {
  const now = 1_000_000;

  it("is stopped when no desktop session is running", () => {
    expect(desktopStreamMode({ running: false, streaming: true, lastStreamAt: now, now })).toBe("stopped");
  });

  it("is live while a stream call is open", () => {
    expect(desktopStreamMode({ running: true, streaming: true, lastStreamAt: 0, now })).toBe("live");
  });

  it("stays on the live wording during a reconnect (no blink)", () => {
    // The stream just ended (streaming false) but the last frame arrived 1 s ago: this is a reconnect, not a fallback.
    expect(desktopStreamMode({ running: true, streaming: false, lastStreamAt: now - 1_000, now })).toBe("reconnecting");
  });

  it("falls back to the snapshot poll only after the grace period", () => {
    expect(desktopStreamMode({ running: true, streaming: false, lastStreamAt: now - 20_000, now })).toBe("snapshot");
    expect(desktopStreamMode({ running: true, streaming: false, lastStreamAt: 0, now })).toBe("snapshot");
  });

  it("honours a custom grace period", () => {
    expect(desktopStreamMode({ running: true, streaming: false, lastStreamAt: now - 3_000, now, graceMs: 2_000 })).toBe("snapshot");
    expect(desktopStreamMode({ running: true, streaming: false, lastStreamAt: now - 3_000, now, graceMs: 5_000 })).toBe("reconnecting");
  });
});
