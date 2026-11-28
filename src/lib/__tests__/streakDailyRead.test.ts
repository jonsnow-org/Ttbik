import { DAILY_READS, dailyReadFor, dailyReadText } from "@/lib/streakDailyRead";

const day = (n: number) => new Date(n * 86_400_000 + 12 * 3600_000);

test("a UTC day maps to one card, and the next day is the next card", () => {
  const a = dailyReadFor(day(10_000));
  const b = dailyReadFor(day(10_001));
  expect(a.id).not.toBe(b.id);
  expect(dailyReadFor(day(10_000)).id).toBe(a.id);
  expect(DAILY_READS.filter((c) => c.kind === "ayah").length).toBeGreaterThan(5);
  expect(DAILY_READS.every((c) => c.body.length > 10 && c.takeaway.length > 8)).toBe(true);
});

test("the chat text carries the title, the body and the check-in line", () => {
  const c = dailyReadFor(day(10_000));
  const text = dailyReadText(day(10_000));
  expect(text).toContain(c.title);
  expect(text).toContain(c.body.split("\n")[0]);
  expect(text).toContain("سلسلة القراءة");
});
