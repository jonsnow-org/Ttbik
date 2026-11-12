import { botCallbackRestriction } from "@/lib/botCallbackRestriction";

describe("stale callback moderation", () => {
  const now = Date.parse("2026-11-12T18:00:00.000Z");
  it("denies banned users even if their mute has expired", () => {
    expect(botCallbackRestriction(true, new Date(now - 1), now)).toBe("banned");
  });
  it("denies a currently muted user", () => {
    expect(botCallbackRestriction(false, new Date(now + 1), now)).toBe("muted");
  });
  it("allows expired, missing, and invalid mute dates", () => {
    expect(botCallbackRestriction(false, new Date(now), now)).toBeNull();
    expect(botCallbackRestriction(false, new Date(now - 1), now)).toBeNull();
    expect(botCallbackRestriction(false, null, now)).toBeNull();
    expect(botCallbackRestriction(false, "not-a-date", now)).toBeNull();
  });
});
