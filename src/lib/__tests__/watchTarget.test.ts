import { isTimedClickReady, timedClickStatus, UNOPENED_CLICK_AT, normalizeTargetUrl } from "@/lib/watchTarget";

describe("AD_BOT tracked outbound visits", () => {
  const now = Date.parse("2026-11-11T12:00:00.000Z");

  it("does not start the timer when the card is only issued", () => {
    expect(isTimedClickReady({ issuedAt: UNOPENED_CLICK_AT, verified: false }, now, 15)).toBe(false);
    expect(timedClickStatus({ issuedAt: UNOPENED_CLICK_AT, verified: false }, now, 15)).toEqual({ started: false, remainingSeconds: 15 });
  });

  it("does not pay before the server-recorded click has waited 15 seconds", () => {
    const click = { issuedAt: new Date(now - 14_000), verified: true };
    expect(isTimedClickReady(click, now, 15)).toBe(false);
    expect(timedClickStatus(click, now, 15)).toEqual({ started: true, remainingSeconds: 1 });
  });

  it("pays only after the recorded click timer has elapsed", () => {
    const click = { issuedAt: new Date(now - 15_000), verified: true };
    expect(isTimedClickReady(click, now, 15)).toBe(true);
    expect(timedClickStatus(click, now, 15)).toEqual({ started: true, remainingSeconds: 0 });
  });

  it("allows an already-verified in-platform bot hand-off immediately", () => {
    const click = { issuedAt: UNOPENED_CLICK_AT, verified: true };
    expect(isTimedClickReady(click, now, 15)).toBe(true);
    expect(timedClickStatus(click, now, 15)).toEqual({ started: true, remainingSeconds: 0 });
  });

  it("uses an adv_ deep link for Telegram bot targets", () => {
    expect(normalizeTargetUrl("TELEGRAM", "@ExampleBot", "click-123")).toBe("https://t.me/ExampleBot?start=adv_click-123");
  });
});
