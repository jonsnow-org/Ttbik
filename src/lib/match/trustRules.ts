/**
 * «زواج بثقة» (2026-11-10) — pure rules for the shareable anonymous card and the paid
 * human matchmaker request. No DB, no network: unit-tested in src/lib/__tests__/matchTrust.test.ts.
 *
 * Privacy: the card is built only from publicCardText() (short id, gender, age, country,
 * city, job, education, marital status — all scrubbed of contacts). No name, photo or username.
 */
export const CARD_BUTTON = "🪪 بطاقتي للمشاركة";
export const CARD_INLINE_QUERY = "بطاقتي";
/** Deep link payload a member's OWN shared card carries: c_<profile uuid>. Credits the card owner as referrer. */
export const CARD_START_PREFIX = "c_";

export const PRICE_MATCHMAKER = 5; // USD from the bot balance (= 500 ⭐ at 100 ⭐/$)
export const MATCHMAKER_BUTTON = `💍 خاطبة شخصية ($${PRICE_MATCHMAKER})`;
export const MATCHMAKER_NOTE_MAX = 500;
export const MATCHMAKER_SLA_HOURS = 72;
export const MATCHMAKER_STARS_KIND = "MATCH_MM";

export function cardStartPayload(profileId: string): string {
  return `${CARD_START_PREFIX}${profileId}`;
}
export function cardLink(botUsername: string, profileId: string): string {
  return `https://t.me/${botUsername.replace(/^@/, "")}?start=${cardStartPayload(profileId)}`;
}
/** Returns the profile uuid of a c_<uuid> payload (start payloads allow 64 chars; a uuid fits). */
export function parseCardStart(payload: string | null | undefined): string | null {
  const m = String(payload || "").match(/^c_([0-9a-fA-F-]{36})$/);
  return m ? m[1].toLowerCase() : null;
}
export function isCardInlineQuery(q: string | null | undefined): boolean {
  const s = String(q || "").trim().toLowerCase();
  return s === CARD_INLINE_QUERY || s === "me" || s === "card";
}

export function cardShareText(card: string): string {
  return `${card}\n\n💌 تعرف شخصاً مناسباً؟ أرسل له هذه البطاقة. التعارف عبر البوت فقط، بلا كشف أي بيانات قبل موافقة الطرفين.`;
}

export type NoteCheck = { ok: true; note: string } | { ok: false; reason: "empty" | "long" | "contact" };
/** The matchmaker note is free text from the member: trimmed, bounded, and never carries contact details. */
export function checkMatchmakerNote(raw: string, hasContact: (s: string) => boolean): NoteCheck {
  const note = String(raw || "").trim();
  if (note.length < 10) return { ok: false, reason: "empty" };
  if (note.length > MATCHMAKER_NOTE_MAX) return { ok: false, reason: "long" };
  if (hasContact(note)) return { ok: false, reason: "contact" };
  return { ok: true, note };
}

/** Stars needed to cover the shortfall (100 ⭐ = $1, at least 1 ⭐). */
export function shortfallStars(price: number, balance: number): number {
  return Math.max(1, Math.ceil((price - Math.max(0, balance)) * 100 - 1e-9));
}

export const MATCHMAKER_INTRO =
  `💍 الخاطبة الشخصية\n\n` +
  `إنسان من فريق البوت (وليس ذكاءً اصطناعياً) يقرأ ما تبحث عنه، ويراجع الملفات المعتمدة بنفسه، ثم يرسل لك حتى 3 ملفات مناسبة خلال ${MATCHMAKER_SLA_HOURS} ساعة.\n\n` +
  `• السعر: $${PRICE_MATCHMAKER} لطلب واحد (من رصيدك أو بالنجوم).\n` +
  `• لا يُكشف أي شيء عنك لأحد. أنت من يقرر مراسلة الملف المقترح.\n` +
  `• إن لم نجد لك أي ملف مناسب يعاد المبلغ إلى رصيدك.`;

// ---------------------------------------------------------------------------
// 💍 Matchmaker candidates: the admin gets the best approved profiles ready to send.
// ---------------------------------------------------------------------------
export const MATCHMAKER_CANDIDATES = 5;
/** Profiles whose owner was active within this many days score higher (never excluded). */
export const MATCHMAKER_ACTIVE_DAYS = 14;

export type CandidateInput = {
  id: string; userId: string; gender: string; age: number; country: string;
  city?: string | null; job?: string | null; education?: string | null; maritalStatus?: string | null; attributes?: string | null;
  lastActiveAt?: Date | null;
};
export type RequesterInput = {
  userId: string; gender: string;
  pref?: { country?: string | null; ageMin?: number | null; ageMax?: number | null; city?: string | null; maritalStatus?: string | null; job?: string | null; education?: string | null } | null;
  note?: string | null;
};

const normAr = (s: string | null | undefined) =>
  String(s || "").toLowerCase().replace(/[\u064B-\u065F\u0670]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();
const STOP = new Set(["ابحث", "عن", "من", "في", "بين", "الي", "او", "مع", "سنه", "سنة", "عمر", "العمر", "شريك", "شريكه", "زوج", "زوجه", "تكون", "يكون", "اريد", "ملتزم", "ملتزمه"].map(normAr));

/** Age range written in the note ("بين 24 و30", "25-32"): the smallest and largest numbers in 18..80, if any. */
export function noteAgeRange(note: string | null | undefined): { min: number; max: number } | null {
  const digits = String(note || "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  const nums = (digits.match(/\d{2}/g) || []).map(Number).filter((n) => n >= 18 && n <= 80);
  if (!nums.length) return null;
  return { min: Math.min(...nums), max: Math.max(...nums) };
}

/** Meaningful words of the note (3+ letters, no filler), normalised for matching. */
export function noteKeywords(note: string | null | undefined): string[] {
  return [...new Set(normAr(note).split(/[^\p{L}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)))].slice(0, 30);
}

/**
 * Ranks candidates for one request. Hard rules: opposite gender, adult, not the requester.
 * Soft score: country, age range (preferences, else the note), city, marital status, words of the note, recent activity.
 */
export function rankMatchmakerCandidates(req: RequesterInput, list: CandidateInput[], now = new Date(), limit = MATCHMAKER_CANDIDATES): CandidateInput[] {
  const want = req.gender === "MALE" ? "FEMALE" : "MALE";
  const pref = req.pref || {};
  const range = pref.ageMin != null || pref.ageMax != null ? { min: pref.ageMin ?? 18, max: pref.ageMax ?? 99 } : noteAgeRange(req.note);
  const words = noteKeywords(req.note);
  const scored = list
    .filter((c) => c.userId !== req.userId && c.gender === want && c.age >= 18)
    .map((c) => {
      let s = 0;
      if (pref.country && normAr(c.country) === normAr(pref.country)) s += 30;
      if (range) {
        const d = c.age < range.min ? range.min - c.age : c.age > range.max ? c.age - range.max : 0;
        s += d === 0 ? 25 : d <= 3 ? 10 : d <= 7 ? 2 : -10;
      }
      if (pref.city && c.city && normAr(c.city) === normAr(pref.city)) s += 12;
      if (pref.maritalStatus && c.maritalStatus && normAr(c.maritalStatus).includes(normAr(pref.maritalStatus))) s += 8;
      if (words.length) {
        const hay = normAr([c.country, c.city, c.job, c.education, c.maritalStatus, c.attributes].filter(Boolean).join(" "));
        s += Math.min(5, words.filter((w) => hay.includes(w)).length) * 6;
      }
      const days = c.lastActiveAt ? (now.getTime() - c.lastActiveAt.getTime()) / 86400_000 : Infinity;
      s += days <= 3 ? 15 : days <= MATCHMAKER_ACTIVE_DAYS ? 8 : days <= 60 ? 2 : 0;
      return { c, s };
    });
  scored.sort((a, b) => b.s - a.s || (b.c.lastActiveAt?.getTime() ?? 0) - (a.c.lastActiveAt?.getTime() ?? 0));
  return scored.slice(0, limit).map((x) => x.c);
}

/** Callback data of «📤 اقترح» for one profile (Telegram allows 64 bytes; a uuid + request id fit). */
export function suggestCallback(reqId: string, profileId: string): string {
  return `mm_sug|${reqId}|${profileId}`;
}
