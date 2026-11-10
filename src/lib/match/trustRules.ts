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
