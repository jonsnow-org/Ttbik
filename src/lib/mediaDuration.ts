/** Parse a requested video length before the prompt is translated for the media model. */
const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};
const WORD_SECONDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  واحد: 1, واحدة: 1, وحده: 1,
  اثنين: 2, اثنتين: 2, ثنتين: 2, ثانيتين: 2,
  ثلاث: 3, ثلاثه: 3,
  اربع: 4, اربعه: 4,
  خمس: 5, خمسه: 5,
};
const UNIT = "(?:\\\\b(?:seconds?|secs?|sec|s)\\\\b|(?:ثانية|ثانيه|ثانيتين|ثوان(?:ي)?)(?=$|[^\\\\u0600-\\\\u06FF]))";
const MAX_VIDEO_SECONDS = 5;

function normalizeDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (digit) => ARABIC_DIGITS[digit] || digit)
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}

/** Default 3 seconds, explicit requests 1–5 seconds. It does not alter the textual prompt. */
export function requestedVideoSeconds(text: string, fallback = 3): number {
  const raw = normalizeDigits(String(text || "").toLowerCase());
  const safeFallback = Math.max(1, Math.min(MAX_VIDEO_SECONDS, Math.round(Number(fallback) || 3)));

  const numeric = new RegExp("(\\d{1,2}(?:\\.\\d+)?)\\s*" + UNIT + "\\b", "i").exec(raw);
  if (numeric) {
    const amount = Number(numeric[1]);
    if (Number.isFinite(amount) && amount > 0) return Math.max(1, Math.min(MAX_VIDEO_SECONDS, Math.round(amount)));
  }

  const words = new RegExp("\\b(one|two|three|four|five|واحده?|وحده|اثنين|اثنتين|ثنتين|ثانيتين|ثلاثه?|ثلاثة|اربع|أربعة|اربع|اربعه|خمسه?|خمسة)\\s*" + UNIT + "\\b", "i").exec(raw);
  if (words) {
    const key = words[1].replace(/[أإآ]/g, "ا").replace(/ة/g, "ه");
    const amount = WORD_SECONDS[key];
    if (amount) return amount;
  }

  // Accept a spoken number after "duration" even when Arabic syntax places the unit first.
  if (/ثانيتين/.test(raw)) return 2;
  if (/(?:لمدة|مده|طول|duration)\\s*(?:ثلاث|ثلاثه|ثلاثة)/.test(raw)) return 3;
  if (/خمس|خمسة|خمسه/.test(raw) && /ثوان|ثانيه|ثانية/.test(raw)) return 5;
  if (/اربع|أربع|أربعة|اربعه/.test(raw) && /ثوان|ثانيه|ثانية/.test(raw)) return 4;
  if (/ثلاث|ثلاثه|ثلاثة/.test(raw) && /ثوان|ثانيه|ثانية/.test(raw)) return 3;
  if (/واحد|واحدة|وحده/.test(raw) && /ثوان|ثانيه|ثانية/.test(raw)) return 1;

  return safeFallback;
}
