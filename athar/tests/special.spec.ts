import { SEASON_1, seasonSize, specialIndex } from "../web/lib/seasons";
import { specialScene, specialKey } from "../web/lib/specialArt";
import { indexOf } from "../web/lib/dates";

describe("special dates", () => {
  it("make the first season exactly 3000 dates, with no duplicates and none inside the plain 2000-2007 range", () => {
    expect(seasonSize(SEASON_1)).toBe(3000);
    const idx = SEASON_1.specials.map(specialIndex);
    expect(new Set(idx).size).toBe(idx.length);
    for (const i of idx) expect(i < SEASON_1.rangeStart || i > SEASON_1.rangeEnd).toBe(true);
    for (const i of idx) expect(i).toBeGreaterThanOrEqual(0);
  });
  it("every special date has its own original artwork; only the two Syrian dates carry the flag overlay in colour", () => {
    for (const s of SEASON_1.specials) {
      const a = specialScene(specialIndex(s));
      expect(a).not.toBeNull();
      expect(a!.scene).toContain("<svg");
      expect(a!.scene.length).toBeGreaterThan(400);
      expect(a!.scene.length).toBeLessThan(60000);
    }
    const syr = [indexOf(2011, 3, 15), indexOf(2024, 12, 8)];
    for (const i of syr) {
      const a = specialScene(i)!;
      expect(a.overlay).toContain("#007a3d");       // green
      expect(a.overlay).toContain("#ce1126");       // the three red stars
      expect(a.overlay).toContain("#000000");
    }
    const others = SEASON_1.specials.map(specialIndex).filter((i) => !syr.includes(i));
    for (const i of others) expect(specialScene(i)!.overlay).toBeUndefined();
    expect(specialKey(syr[0])).toBe("2011-03-15");
  });
});
