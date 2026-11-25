import { SKILL_PRESETS, presetSchedule, presetEnabled } from "@/lib/skillPresets";
import { validate } from "@/lib/coderSchedules";

describe("one-click Skills (scheduled-task presets)", () => {
  it("every preset is a valid scheduled task in the user's time zone", () => {
    for (const p of SKILL_PRESETS) {
      const body = presetSchedule(p, "ar", "Asia/Damascus", p.needsRepo ? "me/repo" : undefined);
      const v = validate(body);
      expect(v.ok).toBe(true);
      expect(body.tz).toBe("Asia/Damascus");
    }
  });
  it("ids are unique, a repo is attached only where needed, and the enabled check matches either language", () => {
    expect(new Set(SKILL_PRESETS.map((p) => p.id)).size).toBe(SKILL_PRESETS.length);
    const daily = SKILL_PRESETS.find((p) => p.id === "daily-briefing")!;
    expect(presetSchedule(daily, "en", "UTC", "me/repo").repo).toBeUndefined();
    expect(presetEnabled(daily, [presetSchedule(daily, "en", "UTC").title])).toBe(true);
    expect(presetEnabled(daily, ["something else"])).toBe(false);
  });
});
