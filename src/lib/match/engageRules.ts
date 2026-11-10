/**
 * MARRIAGE_BOT engagement rules (owner-approved 2026-11-11): the profile completeness meter and the opt-in
 * daily «3 best matches» digest. Pure, unit-tested in matchEngage.test.ts.
 */

// ---------------------------------------------------------------------------
// 📊 Profile completeness
// ---------------------------------------------------------------------------
export type CompletenessInput = {
  photo: boolean; voice: boolean; city?: string | null; job?: string | null; education?: string | null;
  maritalStatus?: string | null; attributes?: string | null; hasPref: boolean; quizDone: boolean; verified: boolean;
};
/** Each item: weight and the tip shown while it is missing (most useful first). */
const ITEMS: { key: keyof CompletenessInput | "about"; w: number; tip: string; done: (i: CompletenessInput) => boolean }[] = [
  { key: "photo", w: 20, tip: "📸 أضف صورة (تظهر فقط لمن تسمح له) — الملفات بصورة تُراسَل أكثر بكثير.", done: (i) => i.photo },
  { key: "about", w: 15, tip: "📝 اكتب نبذة من 30 حرفاً على الأقل عن نفسك وما تبحث عنه.", done: (i) => String(i.attributes || "").trim().length >= 30 },
  { key: "hasPref", w: 15, tip: "💍 حدّد «مواصفات الشريك» لتظهر لك مطابقات أدق ونسبة التوافق.", done: (i) => i.hasPref },
  { key: "city", w: 10, tip: "🏙 أضف مدينتك — كثيرون يبحثون بالمدينة.", done: (i) => !!String(i.city || "").trim() },
  { key: "job", w: 10, tip: "💼 أضف عملك.", done: (i) => !!String(i.job || "").trim() },
  { key: "education", w: 8, tip: "🎓 أضف تعليمك.", done: (i) => !!String(i.education || "").trim() },
  { key: "maritalStatus", w: 7, tip: "💍 أضف حالتك الاجتماعية.", done: (i) => !!String(i.maritalStatus || "").trim() },
  { key: "voice", w: 5, tip: "🎙 سجّل تعريفاً صوتياً قصيراً من البوت (اختياري).", done: (i) => i.voice },
  { key: "quizDone", w: 5, tip: "🧠 أجب عن أسئلة القيم لتظهر نسبة تطابق القيم.", done: (i) => i.quizDone },
  { key: "verified", w: 5, tip: "☑️ وثّق ملفك ليحصل على الشارة وثقة أكبر.", done: (i) => i.verified },
];
export function profileCompleteness(i: CompletenessInput): { percent: number; tips: string[] } {
  const total = ITEMS.reduce((a, x) => a + x.w, 0);
  const got = ITEMS.filter((x) => x.done(i)).reduce((a, x) => a + x.w, 0);
  return { percent: Math.round((got / total) * 100), tips: ITEMS.filter((x) => !x.done(i)).map((x) => x.tip) };
}
export function completenessLine(c: { percent: number; tips: string[] }): string {
  const bar = "▰".repeat(Math.round(c.percent / 10)) + "▱".repeat(10 - Math.round(c.percent / 10));
  return c.tips.length ? `📊 اكتمال ملفك: ${c.percent}% ${bar}\n💡 ${c.tips[0]}` : `📊 اكتمال ملفك: 100% ${bar} — ممتاز!`;
}

// ---------------------------------------------------------------------------
// 🔔 Daily «3 best matches» digest (opt-in)
// ---------------------------------------------------------------------------
export const DIGEST_SIZE = 3;
export const DIGEST_BUTTON_ON = "🔔 أفضل 3 مطابقات يومياً";
export const DIGEST_BUTTON_OFF = "🔕 إيقاف الملخص اليومي";
export const DIGEST_OFF_CALLBACK = "mdg_off";
export const DIGEST_ON_CALLBACK = "mdg_on";
export type DigestCandidate = { userId: string; compat: number | null; twoWay: boolean; likedMe: boolean; likedByMe: boolean; sentBefore: boolean; activeDays: number };
/**
 * The day's best 3 from the bot's own (already privacy-filtered) search queue: never a profile already in an
 * earlier digest or already liked by the member; ranked by two-way fit, compatibility, a like from them, and activity.
 */
export function pickDigest(list: DigestCandidate[], size = DIGEST_SIZE): string[] {
  return list
    .filter((c) => !c.sentBefore && !c.likedByMe)
    .map((c) => ({ id: c.userId, s: (c.twoWay ? 30 : 0) + (c.compat ?? 40) + (c.likedMe ? 15 : 0) + (c.activeDays <= 3 ? 10 : c.activeDays <= 14 ? 5 : 0) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, size)
    .map((x) => x.id);
}
