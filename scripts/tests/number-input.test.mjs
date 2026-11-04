import test from "node:test";
import assert from "node:assert/strict";
import { parseLocalizedNumber } from "../../src/lib/numberInput.ts";

test("parses Arabic-Indic digits and Arabic decimal/thousands marks", () => {
  assert.equal(parseLocalizedNumber("١٬٢٣٤٫٥٦"), 1234.56);
  assert.equal(parseLocalizedNumber("١٢٣٫٥"), 123.5);
});

test("parses Persian digits and Western grouped numbers", () => {
  assert.equal(parseLocalizedNumber("۱۲۳۴٫۵"), 1234.5);
  assert.equal(parseLocalizedNumber("1,234.50"), 1234.5);
});

test("preserves decimal-comma fields used by invoice and shared-costs tools", () => {
  assert.equal(parseLocalizedNumber("١٢٣,٥٠", { commaDecimal: true }), 123.5);
  assert.equal(parseLocalizedNumber("123,50", { commaDecimal: true }), 123.5);
});

test("handles signs, surrounding labels and empty/invalid values", () => {
  assert.equal(parseLocalizedNumber("−١٢٫٥ ريال"), -12.5);
  assert.equal(parseLocalizedNumber(""), 0);
  assert.equal(parseLocalizedNumber("1.2.3"), 0);
  assert.ok(Number.isNaN(parseLocalizedNumber("", { fallback: NaN })));
});

test("normalizes Persian digits for BigInt-safe string consumers", async () => {
  const { normalizeLocalizedDigits } = await import("../../src/lib/numberInput.ts");
  assert.equal(normalizeLocalizedDigits("۹۹۹٬۹۹۹٫۲۵"), "999999.25");
  assert.equal(normalizeLocalizedDigits("١٢٣٤٥٦"), "123456");
});

test("interprets one or two comma decimals and preserves three-digit thousands groups", () => {
  assert.equal(parseLocalizedNumber("2,5"), 2.5);
  assert.equal(parseLocalizedNumber("2،5"), 2.5);
  assert.equal(parseLocalizedNumber("−٢،٥"), -2.5);
  assert.equal(parseLocalizedNumber("1,250"), 1250);
  assert.equal(parseLocalizedNumber("١،٢٥"), 1.25);
});
