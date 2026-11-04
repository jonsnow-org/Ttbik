export type LocalizedNumberOptions = {
  /** Use a comma as the decimal mark for fields that already follow that convention. */
  commaDecimal?: boolean;
  /** Value returned for empty or malformed input. */
  fallback?: number;
};

/**
 * Convert Arabic-Indic and Persian digits to Western digits, and normalize
 * Arabic decimal/thousands separators. The result remains text so callers
 * that use BigInt can preserve large integers without a Number conversion.
 */
export function normalizeLocalizedDigits(value: string): string {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) =>
      String(digit.charCodeAt(0) - "٠".charCodeAt(0)),
    )
    .replace(/[۰-۹]/g, (digit) =>
      String(digit.charCodeAt(0) - "۰".charCodeAt(0)),
    )
    .replace(/[٫﹒．]/g, ".")
    .replace(/[٬،，\u00A0\u202F\s]/g, "")
    .replace(/[−﹣－]/g, "-");
}

/**
 * Parse numeric text entered with Western, Arabic-Indic or Persian digits.
 * Arabic decimal/thousands marks are normalized without changing the
 * calculator's downstream arithmetic or currency conventions.
 */
export function parseLocalizedNumber(
  value: string,
  options: LocalizedNumberOptions = {},
): number {
  const fallback = options.fallback ?? 0;
  let normalized = normalizeLocalizedDigits(value);

  if (options.commaDecimal) {
    normalized = normalized.replace(/,/g, ".");
  } else {
    normalized = normalized.replace(/[,，]/g, "");
  }

  normalized = normalized.replace(/[^0-9.+\-eE]/g, "");

  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)
  ) {
    return fallback;
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}
