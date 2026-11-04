import test from "node:test";
import assert from "node:assert/strict";
import { calculatePercentageChange } from "../../src/lib/percentageChange.ts";

test("calculates increases and decreases against the absolute starting value", () => {
  assert.equal(calculatePercentageChange(100, 130), 30);
  assert.equal(calculatePercentageChange(100, 70), -30);
  assert.equal(calculatePercentageChange(-100, -130), -30);
});

test("returns no percentage when the starting value is zero or an input is invalid", () => {
  assert.equal(calculatePercentageChange(0, 10), null);
  assert.equal(calculatePercentageChange(10, Number.NaN), null);
  assert.equal(calculatePercentageChange(Number.POSITIVE_INFINITY, 10), null);
});
