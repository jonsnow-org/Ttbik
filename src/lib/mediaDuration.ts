/** Parse the user's requested video duration before the model prompt is translated or rewritten. */
const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};
const WORD_SECONDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  واحد: 1, واحده: 1, وحده: 1,
  اثنين: 2, اثنتين: 2, ثنتين: 2, ثانيتين: 2,
  ثلاث: 3, ثلاثه: 3,
  اربع: 4, اربعه: 4,
  خمس: 5, خمسه: 5,
};
const MAX_VIDEO_SECONDS = 5;

function normalizeDurationText(value: string): string {
  return value.toLowerCase()
    .replace(/[٠-٩]/g, (digit) => ARABIC_DIGITS[digit] || digit)
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/\s+/g, " ");
}

function boundedSeconds(value: number): number {
  return Math.max(1, Math.min(MAX_VIDEO_SECONDS, Math.round(value)));
}

/** Returns an explicit 1–5 second duration, or null when the user did not specify one. */
export function explicitVideoSeconds(text: string): number | null {
  const raw = normalizeDurationText(String(text || ""));
  const unit = String.raw`(?:\b(?:seconds?|secs?|sec|s)\b|(?:ثانيه|ثانيتين|ثوان(?:ي)?)(?=$|[^\u0600-\u06FF]))`;
  const numeric = new RegExp(String.raw`(\d{1,2}(?:\.\d+)?)\s*-?\s*` + unit, "i").exec(raw);
  if (numeric) {
    const amount = Number(numeric[1]);
    if (Number.isFinite(amount) && amount > 0) return boundedSeconds(amount);
  }

  const word = new RegExp(
    String.raw`(one|two|three|four|five|واحده?|وحده|اثنين|اثنتين|ثنتين|ثلاثه?|اربع(?:ه)?|خمسه?)\s*-?\s*` + unit,
    "i",
  ).exec(raw);
  if (word) {
    const amount = WORD_SECONDS[word[1]];
    if (amount) return amount;
  }

  if (/ثانيتين/.test(raw)) return 2;
  if (/ثانيه/.test(raw) && !/ثوان/.test(raw)) return 1;
  if (/(?:خمس|خمسه).*ثوان/.test(raw)) return 5;
  if (/(?:اربع|اربعه).*ثوان/.test(raw)) return 4;
  if (/(?:ثلاث|ثلاثه).*ثوان/.test(raw)) return 3;
  if (/(?:واحد|واحده|وحده).*ثوان/.test(raw)) return 1;
  return null;
}

/** Default to three seconds only when the user did not state a duration. */
export function requestedVideoSeconds(text: string, fallback = 3): number {
  const explicit = explicitVideoSeconds(text);
  if (explicit !== null) return explicit;
  const safeFallback = Number.isFinite(Number(fallback)) ? Number(fallback) : 3;
  return boundedSeconds(safeFallback || 3);
}
