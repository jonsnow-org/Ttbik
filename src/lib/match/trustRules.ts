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

/** A paid matchmaker request needs at least one eligible approved profile to suggest. */
export function hasMatchmakerInventory(gender: string, candidateCount: number): boolean {
  return (gender === "MALE" || gender === "FEMALE") && Number.isSafeInteger(candidateCount) && candidateCount > 0;
}
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
  /** ☑️ verified badge (small tiebreak). */
  verified?: boolean;
  /** The candidate's own partner preferences — used for the reciprocal fit (does the requester suit THEM?). */
  pref?: { country?: string | null; ageMin?: number | null; ageMax?: number | null } | null;
  /** The candidate already liked the requester (a likely mutual match). Admin-only signal, never shown to the requester. */
  likedRequester?: boolean;
  /** The requester skipped this profile recently — ranked lower, never excluded. */
  passedByRequester?: boolean;
};
export type RequesterInput = {
  userId: string; gender: string;
  /** Profiles this member marked «🙅 غير مناسب» on earlier suggestions (any request). */
  rejections?: Rejection[];
  /** The requester's own age/country: the default country wish and the reciprocal fit. */
  age?: number | null; country?: string | null;
  pref?: { country?: string | null; ageMin?: number | null; ageMax?: number | null; city?: string | null; maritalStatus?: string | null; job?: string | null; education?: string | null } | null;
  note?: string | null;
};

const normAr = (s: string | null | undefined) =>
  String(s || "").toLowerCase().replace(/[\u064B-\u065F\u0670]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();
const STOP = new Set(["ابحث", "عن", "من", "في", "بين", "الي", "او", "مع", "سنه", "سنة", "عمر", "العمر", "شريك", "شريكه", "زوج", "زوجه", "تكون", "يكون", "اريد", "ملتزم", "ملتزمه"].map(normAr));
/** Loose text match (either contains the other), on normalised Arabic. */
const loose = (have: string | null | undefined, want: string | null | undefined) => {
  const h = normAr(have), w = normAr(want);
  return !!h && !!w && (h.includes(w) || w.includes(h));
};

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
 * Does the requester suit the CANDIDATE's own partner preferences? "fit" when every stated wish holds
 * (country, age range), "miss" when one clearly fails (age more than 3 years outside), "unknown" without wishes.
 */
export function reciprocalFit(req: { age?: number | null; country?: string | null }, candPref: CandidateInput["pref"]): "fit" | "miss" | "unknown" {
  if (!candPref) return "unknown";
  let stated = 0, fails = 0;
  if (candPref.country && req.country) { stated++; if (normAr(candPref.country) !== normAr(req.country)) fails++; }
  if ((candPref.ageMin != null || candPref.ageMax != null) && req.age != null) {
    stated++;
    const d = candPref.ageMin != null && req.age < candPref.ageMin ? candPref.ageMin - req.age : candPref.ageMax != null && req.age > candPref.ageMax ? req.age - candPref.ageMax : 0;
    if (d > 3) fails++;
  }
  if (!stated) return "unknown";
  return fails ? "miss" : "fit";
}

type Scored = { c: CandidateInput; s: number; why: string[] };
function scoreCandidate(req: RequesterInput, c: CandidateInput, now: Date): Scored {
  const pref = req.pref || {};
  const range = pref.ageMin != null || pref.ageMax != null ? { min: pref.ageMin ?? 18, max: pref.ageMax ?? 99 } : noteAgeRange(req.note);
  const words = noteKeywords(req.note);
  const why: string[] = [];
  let s = 0;
  // Country: the stated wish; without one, the requester's own country (same default as the bot's search, defaultPref).
  if (pref.country) { if (normAr(c.country) === normAr(pref.country)) { s += 30; why.push("الدولة"); } }
  else if (req.country && normAr(c.country) === normAr(req.country)) { s += 20; why.push("نفس الدولة"); }
  if (range) {
    const d = c.age < range.min ? range.min - c.age : c.age > range.max ? c.age - range.max : 0;
    s += d === 0 ? 25 : d <= 3 ? 10 : d <= 7 ? 2 : -10;
    if (d === 0) why.push("العمر");
  }
  if (pref.city && c.city && normAr(c.city) === normAr(pref.city)) { s += 12; why.push("المدينة"); }
  if (pref.maritalStatus && c.maritalStatus && normAr(c.maritalStatus).includes(normAr(pref.maritalStatus))) { s += 8; why.push("الحالة الاجتماعية"); }
  if (pref.job && loose(c.job, pref.job)) { s += 8; why.push("العمل"); }
  if (pref.education && loose(c.education, pref.education)) { s += 8; why.push("التعليم"); }
  if (words.length) {
    const hay = normAr([c.country, c.city, c.job, c.education, c.maritalStatus, c.attributes].filter(Boolean).join(" "));
    const hits = Math.min(5, words.filter((w) => hay.includes(w)).length);
    s += hits * 6;
    if (hits) why.push(`كلمات من طلبه (${hits})`);
  }
  // Two-way fit: a profile whose own wishes the requester meets is far more likely to answer.
  const fit = reciprocalFit(req, c.pref);
  if (fit === "fit") { s += 15; why.push("يناسب مواصفاته هو أيضاً"); } else if (fit === "miss") s -= 10;
  if (c.likedRequester) { s += 20; why.push("أعجب بملفه سابقاً"); }
  if (c.passedByRequester) s -= 25;
  if (c.verified) { s += 5; why.push("موثّق"); }
  const fb = req.rejections?.length ? feedbackPenalty(c, req.rejections) : 0;
  if (fb) s -= fb;
  const days = c.lastActiveAt ? (now.getTime() - c.lastActiveAt.getTime()) / 86400_000 : Infinity;
  s += days <= 3 ? 15 : days <= MATCHMAKER_ACTIVE_DAYS ? 8 : days <= 60 ? 2 : 0;
  return { c, s, why };
}

/**
 * Ranks candidates for one request. Hard rules: opposite gender, adult, not the requester.
 * Soft score: country (stated, else the requester's own), age range (preferences, else the note), city, marital status,
 * job, education, words of the note, two-way fit with the candidate's own wishes, an earlier like from the candidate,
 * a recent skip by the requester (lower), the ☑️ badge, and recent activity.
 */
export function rankMatchmakerCandidates(req: RequesterInput, list: CandidateInput[], now = new Date(), limit = MATCHMAKER_CANDIDATES): CandidateInput[] {
  return rankMatchmakerScored(req, list, now, limit).map((x) => x.c);
}
/** Same ranking with the score and the matched criteria (shown to the admin under each card). */
export function rankMatchmakerScored(req: RequesterInput, list: CandidateInput[], now = new Date(), limit = MATCHMAKER_CANDIDATES): Scored[] {
  const want = req.gender === "MALE" ? "FEMALE" : "MALE";
  const scored = list.filter((c) => c.userId !== req.userId && c.gender === want && c.age >= 18).map((c) => scoreCandidate(req, c, now));
  scored.sort((a, b) => b.s - a.s || (b.c.lastActiveAt?.getTime() ?? 0) - (a.c.lastActiveAt?.getTime() ?? 0));
  return scored.slice(0, limit);
}

/** One admin line under a candidate card: why it was picked. */
export function candidateWhyLine(why: string[]): string {
  return why.length ? `✓ ${why.slice(0, 6).join(" · ")}` : "";
}

/**
 * The admin's message when no profile is left for a request: says WHY (already sent, already liked by the
 * requester, hidden by privacy or a block) and what to do next, instead of a bare «لا يوجد».
 */
export function emptyCandidatesText(reqId: string, c: { pool: number; sent: number; liked: number; hidden: number }): string {
  const parts = [
    c.sent ? `${c.sent} أُرسلت له من قبل` : "",
    c.liked ? `${c.liked} أعجب بها بنفسه مسبقاً` : "",
    c.hidden ? `${c.hidden} محجوبة بالحظر أو خصوصية الدولة` : "",
  ].filter(Boolean);
  return [
    `⚠️ لا يوجد الآن ملف معتمد مناسب لطلب #${reqId}.`,
    c.pool ? `فُحص ${c.pool} ملفاً من الجنس المطلوب${parts.length ? `: ${parts.join("، ")}` : ""}.` : "لا توجد ملفات معتمدة ظاهرة من الجنس المطلوب حالياً.",
    "يمكنك: المحاولة لاحقاً (تُضاف ملفات جديدة يومياً)، أو «📨 أرسل رسالة نصية» باقتراح يدوي، أو «↩️ استرداد» ليعود المبلغ لرصيده.",
  ].join("\n");
}

/** Callback data of «📤 اقترح» for one profile (Telegram allows 64 bytes; a uuid + request id fit). */
export function suggestCallback(reqId: string, profileId: string): string {
  return `mm_sug|${reqId}|${profileId}`;
}

/**
 * Search weight from what already happened between the two (multiplies the bot's weighted-random search; never
 * excludes — owner rule 2026-09-30). A profile I already liked comes up far less (nothing new to do there), one
 * that already liked me comes up more (a likely mutual match), and the two-way fit with their own wishes counts.
 */
export function affinityFactor(o: { likedByMe?: boolean; likedMe?: boolean; fit?: "fit" | "miss" | "unknown" }): number {
  let w = 1;
  if (o.likedByMe) w *= 0.2;
  if (o.likedMe) w *= 1.6;
  if (o.fit === "fit") w *= 1.4;
  else if (o.fit === "miss") w *= 0.7;
  return w;
}

/**
 * 🤝 Mutual two-way fit: each side meets the other's stated wishes (country, age range). Needs stated wishes on
 * BOTH sides — without them nothing is claimed. Shown as a badge on cards.
 */
export function twoWayFit(
  a: { age?: number | null; country?: string | null }, aPref: CandidateInput["pref"],
  b: { age?: number | null; country?: string | null }, bPref: CandidateInput["pref"],
): boolean {
  return reciprocalFit(a, bPref) === "fit" && reciprocalFit(b, aPref) === "fit";
}
export const TWO_WAY_BADGE = "🤝 توافق متبادل";

// ---------------------------------------------------------------------------
// 🙅 «غير مناسب» on a matchmaker suggestion: the reason feeds the next ranking for that member.
// ---------------------------------------------------------------------------
export const NOT_SUITABLE_REASONS = {
  age: "العمر",
  place: "الدولة أو المدينة",
  marital: "الحالة الاجتماعية",
  work: "العمل أو التعليم",
  other: "سبب آخر",
} as const;
export type NotSuitableReason = keyof typeof NOT_SUITABLE_REASONS;
export function isNotSuitableReason(s: string | null | undefined): s is NotSuitableReason {
  return !!s && Object.prototype.hasOwnProperty.call(NOT_SUITABLE_REASONS, s);
}
export function notSuitableCallback(reqId: string, profileId: string, reason?: NotSuitableReason): string {
  return reason ? `mm_nsr|${reqId}|${profileId}|${reason}` : `mm_ns|${reqId}|${profileId}`;
}
/** A profile the member marked «غير مناسب», with what it looked like (for the similarity penalty). */
export type Rejection = { reason: NotSuitableReason; age: number; country: string; city?: string | null; maritalStatus?: string | null; job?: string | null; education?: string | null };
/**
 * Score penalty for a candidate that resembles profiles this member rejected, on the dimension they named:
 * age within 2 years (age), same country/city (place), same marital status (marital), similar job/education (work).
 * «سبب آخر» carries no signal. Capped so feedback steers the ranking without wiping a candidate out.
 */
export function feedbackPenalty(c: CandidateInput, rejections: Rejection[]): number {
  let p = 0;
  for (const r of rejections) {
    if (r.reason === "age" && Math.abs(c.age - r.age) <= 2) p += 12;
    else if (r.reason === "place" && (normAr(c.country) === normAr(r.country) && (!r.city || !c.city || normAr(c.city) === normAr(r.city)))) p += 12;
    else if (r.reason === "marital" && r.maritalStatus && c.maritalStatus && normAr(c.maritalStatus) === normAr(r.maritalStatus)) p += 10;
    else if (r.reason === "work" && ((r.job && loose(c.job, r.job)) || (r.education && loose(c.education, r.education)))) p += 8;
  }
  return Math.min(30, p);
}
