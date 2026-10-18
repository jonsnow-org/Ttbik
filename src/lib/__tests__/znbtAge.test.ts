// ZNBt icon age badge: the label for a coin's age, and every label has a pre-rendered file.
import fs from "fs";
import path from "path";
import { ageLabel, AGE_LABELS } from "../znbtAge";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 20);

describe("ZNBt age badge", () => {
  it("counts days, then months, then years", () => {
    const at = (days: number) => ageLabel(T0, T0 + days * DAY + 3600_000);
    expect([0, 1, 2, 29].map(at)).toEqual(["new", "1d", "2d", "29d"]);
    expect([30, 59, 60, 359].map(at)).toEqual(["1m", "1m", "2m", "11m"]);
    expect([360, 365, 729, 730, 4000].map(at)).toEqual(["1y", "1y", "1y", "2y", "10y"]);
  });
  it("shows 'new' before launch, with a clock earlier than the launch, or with no launch time", () => {
    expect(ageLabel(T0, T0 - DAY)).toBe("new");
    expect(ageLabel(NaN, T0)).toBe("new");
    expect(ageLabel(0, T0)).toBe("new");
  });
  it("every label has its pre-rendered icon", () => {
    for (const l of AGE_LABELS) expect(fs.existsSync(path.join(__dirname, "../../../public/zenobia/znbt/age", `${l}.webp`))).toBe(true);
    expect(AGE_LABELS.length).toBe(51);
  });
});
