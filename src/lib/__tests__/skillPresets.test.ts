import { SKILL_CATS, SKILL_PRESETS, filterPresets, presetSchedule, presetEnabled } from "@/lib/skillPresets";
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
  it("every preset has a known category and Explore filters by it and by text in either language", () => {
    const ids = new Set(SKILL_CATS.map((c) => c.id));
    for (const p of SKILL_PRESETS) expect(ids.has(p.cat)).toBe(true);
    for (const c of SKILL_CATS) expect(SKILL_PRESETS.some((p) => p.cat === c.id)).toBe(true);
    expect(filterPresets(SKILL_PRESETS, "", "dev").every((p) => p.cat === "dev")).toBe(true);
    expect(filterPresets(SKILL_PRESETS, "ملخص", "all").map((p) => p.id)).toContain("daily-briefing");
    expect(filterPresets(SKILL_PRESETS, "english", "all").map((p) => p.id)).toEqual(["english-word"]);
    expect(filterPresets(SKILL_PRESETS, "zzz-none", "all")).toEqual([]);
    expect(filterPresets(SKILL_PRESETS, "", "all")).toHaveLength(SKILL_PRESETS.length);
  });
});
