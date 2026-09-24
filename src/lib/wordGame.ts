// «خمّن الكلمة» — daily 5-letter Arabic word-guessing game (Wordle mechanic,
// our own word list and design). Same UTC-day seeding pattern as wordOfDay.ts,
// so the whole site's visitors get the same word on the same day.

export const WORD_LEN = 5;
export const MAX_GUESSES = 6;

// Curated, real, common Arabic words — no proper nouns, no religious terms.
// Letter count verified after stripping diacritics (ة and ء count as their
// own letters; hamza forms أ/إ/آ are treated as ا only for matching, not
// storage, so the board still shows the word's real spelling).
export const WORD_BANK: string[] = [
  "مدرسة", "حديقة", "سيارة", "مكتبة", "طبيبة", "مهندس", "جميلة", "صغيرة",
  "قصيرة", "طويلة", "رياضة", "تفاحة", "عاصفة", "حكاية", "رسالة", "فراشة",
  "مدينة", "جزيرة", "جامعة", "حقيبة", "غزالة", "دجاجة", "زرافة", "ليمون",
  "عصفور", "حمامة", "حرباء", "تمساح", "ثعبان", "كبيرة", "صحراء",
];

export function normalizeLetter(ch: string): string {
  return ch === "أ" || ch === "إ" || ch === "آ" ? "ا" : ch;
}

function utcDayIndex(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000);
}

export function wordOfDayGame(d = new Date()): { word: string; dateIso: string; dayIndex: number } {
  const idx = utcDayIndex(d);
  const word = WORD_BANK[((idx % WORD_BANK.length) + WORD_BANK.length) % WORD_BANK.length];
  const dateIso = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);
  return { word, dateIso, dayIndex: idx };
}

export type LetterState = "correct" | "present" | "absent";

/** Standard Wordle two-pass algorithm: exact matches first, then leftovers, so duplicate letters are scored correctly. */
export function scoreGuess(guess: string, answer: string): LetterState[] {
  const g = [...guess].map(normalizeLetter);
  const a = [...answer].map(normalizeLetter);
  const result: LetterState[] = new Array(g.length).fill("absent");
  const remaining = new Map<string, number>();
  a.forEach((ch, i) => {
    if (g[i] === ch) result[i] = "correct";
    else remaining.set(ch, (remaining.get(ch) || 0) + 1);
  });
  g.forEach((ch, i) => {
    if (result[i] === "correct") return;
    const left = remaining.get(ch) || 0;
    if (left > 0) {
      result[i] = "present";
      remaining.set(ch, left - 1);
    }
  });
  return result;
}

export function isValidGuess(guess: string): boolean {
  if (guess.length !== WORD_LEN) return false;
  return [...guess].every((ch) => /[ء-ي]/.test(ch));
}

const SQUARE: Record<LetterState, string> = { correct: "🟩", present: "🟨", absent: "⬜" };

/** The Wordle-style share text — same viral mechanic, our own brand line. */
export function shareText(dayIndex: number, rows: LetterState[][], won: boolean, siteUrl: string): string {
  const grid = rows.map((r) => r.map((s) => SQUARE[s]).join("")).join("\n");
  const score = won ? `${rows.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  return `خمّن الكلمة #${dayIndex} — ${score}\n\n${grid}\n\n${siteUrl}/guess-word`;
}
