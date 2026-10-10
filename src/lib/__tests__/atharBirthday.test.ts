import { nextBirthday, parseBirthday, reminderText, targetIndex } from "../atharBirthday";
import { indexOf } from "../../../athar/lib/rules";

describe("birthday parsing", () => {
  it("reads the usual shapes, Arabic and Persian digits too", () => {
    expect(parseBirthday("14/3/2003")).toEqual({ month: 3, day: 14, year: 2003 });
    expect(parseBirthday("14-3-2003")).toEqual({ month: 3, day: 14, year: 2003 });
    expect(parseBirthday("2003-03-14")).toEqual({ month: 3, day: 14, year: 2003 });
    expect(parseBirthday("١٤/٣/٢٠٠٣")).toEqual({ month: 3, day: 14, year: 2003 });
    expect(parseBirthday("۱۴ ۳")).toEqual({ month: 3, day: 14, year: null });
    expect(parseBirthday("1/1/99")).toEqual({ month: 1, day: 1, year: 1999 });
  });
  it("refuses what is not a date", () => {
    for (const x of ["", "hello", "32/1/2000", "31/4/2000", "29/2/2001", "14/13/2000", "1/1/2999", "0/5", "1/2/3/4"]) expect(parseBirthday(x, new Date(Date.UTC(2026, 9, 10)))).toBeNull();
    expect(parseBirthday("29/2/2000")).toEqual({ month: 2, day: 29, year: 2000 });
  });
  it("keeps the reminder when the year has no token", () => {
    expect(parseBirthday("5/6/1940")).toEqual({ month: 6, day: 5, year: null });
  });
});

describe("next birthday", () => {
  const at = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 12));
  it("counts the days, today included", () => {
    expect(nextBirthday({ month: 10, day: 17 }, at(2026, 10, 10))).toEqual({ days: 7, year: 2026 });
    expect(nextBirthday({ month: 10, day: 10 }, at(2026, 10, 10))).toEqual({ days: 0, year: 2026 });
    expect(nextBirthday({ month: 1, day: 3 }, at(2026, 12, 27))).toEqual({ days: 7, year: 2027 });
  });
  it("puts 29 February on the 28th in a common year", () => {
    expect(nextBirthday({ month: 2, day: 29 }, at(2027, 2, 21))).toEqual({ days: 7, year: 2027 });
    expect(nextBirthday({ month: 2, day: 29 }, at(2028, 2, 22))).toEqual({ days: 7, year: 2028 });
  });
});

describe("the reminder", () => {
  it("points at the day they were born, or this year's date without a year", () => {
    expect(targetIndex({ month: 3, day: 14, year: 2003 }, 2026)).toEqual({ index: indexOf(2003, 3, 14), own: true });
    expect(targetIndex({ month: 3, day: 14, year: null }, 2027)).toEqual({ index: indexOf(2027, 3, 14), own: false });
    const r = reminderText("ar", { month: 3, day: 14, year: 2003 }, "week", 2027, true);
    expect(r.index).toBe(19430);
    expect(r.text).toMatch(/بعد أسبوع/);
    expect(r.text).toMatch(/متاحاً/);
    expect(reminderText("en", { month: 3, day: 14, year: 2003 }, "day", 2027, false).text).toMatch(/Happy birthday.*14\/3\/2027/);
  });
});
