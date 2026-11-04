import test from "node:test";
import assert from "node:assert/strict";
import {
  addCalendarDays,
  calculateDateDifference,
  formatLocalDate,
} from "../../src/lib/dateDifference.ts";

test("calculates month ends without negative day components", () => {
  assert.deepEqual(
    calculateDateDifference("2024-01-31", "2024-03-01"),
    { years: 0, months: 1, days: 1, totalDays: 30, weeks: 4, hours: 720 },
  );
  assert.deepEqual(
    calculateDateDifference("2023-01-31", "2023-02-28"),
    { years: 0, months: 1, days: 0, totalDays: 28, weeks: 4, hours: 672 },
  );
});

test("treats leap-day to next February as one full calendar year", () => {
  assert.deepEqual(
    calculateDateDifference("2024-02-29", "2025-02-28"),
    { years: 1, months: 0, days: 0, totalDays: 365, weeks: 52, hours: 8760 },
  );
});

test("returns the same positive duration when dates are reversed", () => {
  assert.deepEqual(
    calculateDateDifference("2024-03-01", "2024-01-31"),
    calculateDateDifference("2024-01-31", "2024-03-01"),
  );
});

test("handles identical dates and rejects impossible calendar dates", () => {
  assert.deepEqual(
    calculateDateDifference("2026-11-04", "2026-11-04"),
    { years: 0, months: 0, days: 0, totalDays: 0, weeks: 0, hours: 0 },
  );
  assert.equal(calculateDateDifference("2024-02-30", "2024-03-01"), null);
  assert.equal(calculateDateDifference("", "2024-03-01"), null);
});

test("adds calendar days across year and leap-day boundaries", () => {
  assert.equal(addCalendarDays("2024-02-28", 1), "2024-02-29");
  assert.equal(addCalendarDays("2024-02-29", 1), "2024-03-01");
  assert.equal(addCalendarDays("2025-01-01", -1), "2024-12-31");
  assert.equal(addCalendarDays("2024-01-01", 1.5), "");
});


test("keeps the local calendar day instead of converting it to UTC", () => {
  const localLateEvening = new Date(2026, 10, 4, 23, 30, 0);
  assert.equal(formatLocalDate(localLateEvening), "2026-11-04");
});
