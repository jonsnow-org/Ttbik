import { parseLocalizedNumber } from "@/lib/numberInput";

describe("localized number input", () => {
  it("reads a single decimal comma with one or two digits as a decimal mark", () => {
    expect(parseLocalizedNumber("2,5")).toBe(2.5);
    expect(parseLocalizedNumber("2،5")).toBe(2.5);
    expect(parseLocalizedNumber("2,50")).toBe(2.5);
    expect(parseLocalizedNumber("٢،٥")).toBe(2.5);
    expect(parseLocalizedNumber("۲,۵")).toBe(2.5);
  });
  it("keeps comma thousands groups of three digits", () => {
    expect(parseLocalizedNumber("1,250")).toBe(1250);
    expect(parseLocalizedNumber("1،250،000")).toBe(1250000);
    expect(parseLocalizedNumber("12,345.67")).toBe(12345.67);
  });
  it("reads Arabic decimal mark and digits", () => {
    expect(parseLocalizedNumber("١٥٫٧٥")).toBe(15.75);
    expect(parseLocalizedNumber("٤٠٠")).toBe(400);
  });
  it("uses the fallback for empty or malformed input", () => {
    expect(parseLocalizedNumber("")).toBe(0);
    expect(parseLocalizedNumber("abc", { fallback: NaN })).toBeNaN();
    expect(parseLocalizedNumber("1.2.3", { fallback: NaN })).toBeNaN();
  });
  it("honours commaDecimal for fields that use a comma as the decimal mark", () => {
    expect(parseLocalizedNumber("2,5", { commaDecimal: true })).toBe(2.5);
  });
});
