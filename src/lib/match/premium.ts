/**
 * Premium Mini App logic for MARRIAGE_BOT — pure, deterministic, unit-tested
 * (src/lib/__tests__/matchPremium.test.ts). No DB / network here.
 */
import { resolveCountry } from "@/lib/match/inline";

// ---- limits ------------------------------------------------------------------
export const FREE_SUPERLIKES_PER_DAY = 3;
export const FREE_ANON_CHATS_PER_DAY = 15;
export const COMPLIMENTS_PER_DAY = 5;
export const REFERRALS_FOR_VIP = 3;
export const REFERRAL_VIP_DAYS = 7;

export function dayKey(d = new Date()): string {
  // Day boundary in UTC+3 (owner's timezone, also most of the audience).
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

// ---- compatibility (توافق تقديري) ---------------------------------------------
export type CompatProfile = { gender: string; age: number; country: string; city?: string | null; job?: string | null; education?: string | null; maritalStatus?: string | null; attributes?: string | null };
export type CompatPref = { country?: string | null; ageMin?: number | null; ageMax?: number | null; job?: string | null; education?: string | null; attributes?: string | null } | null;

const n = (v?: string | null) => (v || "").trim().toLowerCase();
const loose = (a?: string | null, b?: string | null) => !!n(a) && !!n(b) && (n(a).includes(n(b)) || n(b).includes(n(a)));
const sameCountry = (a?: string | null, b?: string | null) => !!a && !!b && (n(a) === n(b) || (resolveCountry(a) ?? "x") === (resolveCountry(b) ?? "y"));

/**
 * Deterministic 0..100 estimate: how well `candidate` fits `viewerPref`
 * (70%) and how well the viewer fits the candidate's own pref (30%).
 * Same inputs always give the same number (no randomness).
 */
export function compatibilityScore(candidate: CompatProfile, viewerPref: CompatPref, viewer?: CompatProfile | null, candidatePref?: CompatPref): number {
  const side = (p: CompatProfile, pref: CompatPref, fallbackCountry?: string | null): number => {
    let got = 0, total = 0;
    const add = (w: number, s: number) => { total += w; got += w * s; };
    const wantCountry = pref?.country || fallbackCountry;
    if (wantCountry) add(3, sameCountry(p.country, wantCountry) ? 1 : 0);
    if (pref && (pref.ageMin != null || pref.ageMax != null)) {
      const d = pref.ageMin != null && p.age < pref.ageMin ? pref.ageMin - p.age : pref.ageMax != null && p.age > pref.ageMax ? p.age - pref.ageMax : 0;
      add(3, d === 0 ? 1 : d <= 3 ? 0.6 : d <= 7 ? 0.3 : 0);
    }
    if (pref?.job) add(1, loose(p.job, pref.job) ? 1 : 0);
    if (pref?.education) add(1, loose(p.education, pref.education) ? 1 : 0);
    if (pref?.attributes) {
      const words = n(pref.attributes).split(/[\s,،]+/).filter((w) => w.length > 2);
      const hay = n([p.attributes, p.job, p.education, p.city, p.maritalStatus].join(" "));
      add(1, words.length ? words.filter((w) => hay.includes(w)).length / words.length : 0);
    }
    return total ? got / total : 0.5;
  };
  const a = side(candidate, viewerPref, viewer?.country);
  const b = viewer ? side(viewer, candidatePref ?? null, candidate.country) : a;
  let completeness = 0;
  for (const f of [candidate.job, candidate.education, candidate.city, candidate.maritalStatus, candidate.attributes]) if (n(f)) completeness += 1;
  const raw = 0.7 * a + 0.3 * b;
  const score = Math.round(35 + raw * 60 + completeness); // 35..100
  return Math.max(35, Math.min(99, score));
}

// ---- daily spin wheel ------------------------------------------------------------
export type SpinPrize = { key: "superlike2" | "anon5" | "boost6h" | "boost24h" | "vip1d"; label: string; weight: number };
export const SPIN_PRIZES: SpinPrize[] = [
  { key: "superlike2", label: "⭐ إعجابان مميزان", weight: 40 },
  { key: "anon5", label: "🔀 5 دردشات إضافية", weight: 28 },
  { key: "boost6h", label: "🚀 رفع ملفك 6 ساعات", weight: 22 },
  { key: "boost24h", label: "🚀 رفع ملفك 24 ساعة", weight: 8 },
  { key: "vip1d", label: "👑 VIP ليوم كامل", weight: 2 },
];
/** r must be uniform in [0, 1). Server passes crypto randomness. */
export function pickSpinPrize(r: number): { prize: SpinPrize; index: number } {
  const total = SPIN_PRIZES.reduce((s, p) => s + p.weight, 0);
  let x = Math.max(0, Math.min(0.999999, r)) * total;
  for (let i = 0; i < SPIN_PRIZES.length; i++) {
    x -= SPIN_PRIZES[i].weight;
    if (x < 0) return { prize: SPIN_PRIZES[i], index: i };
  }
  return { prize: SPIN_PRIZES[0], index: 0 };
}
export function canSpin(spinsToday: number): boolean {
  return spinsToday < 1;
}

// ---- referral ------------------------------------------------------------------
export type Referee = { phoneVerified: boolean; isBanned: boolean; profileStatus: string | null };
/** Anti-abuse: only phone-verified, non-banned referees with an APPROVED profile count. */
export function countVerifiedReferrals(refs: Referee[]): number {
  return refs.filter((r) => r.phoneVerified && !r.isBanned && r.profileStatus === "APPROVED").length;
}
export function referralState(verified: number, claimed: boolean): { verified: number; needed: number; canClaim: boolean; claimed: boolean } {
  return { verified, needed: REFERRALS_FOR_VIP, canClaim: !claimed && verified >= REFERRALS_FOR_VIP, claimed };
}

// ---- reveal consent ----------------------------------------------------------------
/** contactRequestedBy is RandomChatSession's existing column. */
export function revealStep(contactRequestedBy: string | null | undefined, me: string): "first" | "waiting" | "mutual" {
  if (!contactRequestedBy) return "first";
  if (contactRequestedBy === me) return "waiting";
  return "mutual";
}

// ---- compliments (preset only, no free text) -------------------------------------------
export const COMPLIMENTS = [
  "ملفك يعكس شخصية محترمة 🌹",
  "يبدو أنك شخص جاد وطموح ✨",
  "أعجبتني طريقة وصفك لنفسك 💫",
  "أتمنى لك التوفيق في إيجاد شريكك 🤍",
  "ذوقك في المواصفات راقٍ 👌",
  "حضورك مميز 🌙",
];
export function complimentText(i: number): string | null {
  return Number.isInteger(i) && i >= 0 && i < COMPLIMENTS.length ? COMPLIMENTS[i] : null;
}

// ---- anonymous chat filters ---------------------------------------------------------------
export type AnonFilter = { gender?: "MALE" | "FEMALE"; country?: string; ageMin?: number; ageMax?: number };
export function sanitizeAnonFilter(b: any): AnonFilter {
  const f: AnonFilter = {};
  if (b?.gender === "MALE" || b?.gender === "FEMALE") f.gender = b.gender;
  if (typeof b?.country === "string" && b.country.trim()) f.country = b.country.trim().slice(0, 40);
  const num = (v: any) => (v === "" || v == null || !Number.isFinite(Number(v)) ? undefined : Math.max(18, Math.min(100, Math.round(Number(v)))));
  f.ageMin = num(b?.ageMin);
  f.ageMax = num(b?.ageMax);
  if (f.ageMin == null) delete f.ageMin;
  if (f.ageMax == null) delete f.ageMax;
  return f;
}
export function anonFilterIsEmpty(f: AnonFilter): boolean {
  return !f.gender && !f.country && f.ageMin == null && f.ageMax == null;
}
/** Candidates without a profile only match an empty filter. */
export function anonCandidateOk(p: { gender: string; age: number; country: string } | null, f: AnonFilter): boolean {
  if (anonFilterIsEmpty(f)) return !p || p.age >= 18;
  if (!p || p.age < 18) return false;
  if (f.gender && p.gender !== f.gender) return false;
  if (f.country && !sameCountry(p.country, f.country)) return false;
  if (f.ageMin != null && p.age < f.ageMin) return false;
  if (f.ageMax != null && p.age > f.ageMax) return false;
  return true;
}

// ---- presentation ----------------------------------------------------------------------------
const FLAGS: Record<string, string> = {
  "السعودية": "🇸🇦", "مصر": "🇪🇬", "الإمارات": "🇦🇪", "الكويت": "🇰🇼", "قطر": "🇶🇦", "البحرين": "🇧🇭", "عمان": "🇴🇲",
  "اليمن": "🇾🇪", "العراق": "🇮🇶", "سوريا": "🇸🇾", "الأردن": "🇯🇴", "فلسطين": "🇵🇸", "لبنان": "🇱🇧", "المغرب": "🇲🇦",
  "الجزائر": "🇩🇿", "تونس": "🇹🇳", "ليبيا": "🇱🇾", "السودان": "🇸🇩", "تركيا": "🇹🇷",
};
export function countryFlag(country: string): string {
  const c = resolveCountry(country) ?? country.trim();
  return FLAGS[c] ?? "🌍";
}
export function onlineLabel(lastActiveAt: Date, now = Date.now()): { online: boolean; label: string } {
  const m = Math.floor((now - lastActiveAt.getTime()) / 60000);
  if (m <= 5) return { online: true, label: "متصل الآن" };
  if (m < 60) return { online: false, label: `قبل ${m} د` };
  const h = Math.floor(m / 60);
  if (h < 24) return { online: false, label: `قبل ${h} س` };
  return { online: false, label: `قبل ${Math.floor(h / 24)} يوم` };
}

export const ICEBREAKERS = [
  "لو تقدر تعيش في أي مدينة بالعالم، وين تختار؟ 🌍",
  "إيش أكثر شي يخليك تبتسم في يومك؟ 😊",
  "إيش الصفة اللي تشوفها أهم شي في شريك الحياة؟",
  "قهوة ولا شاي؟ ☕🍵",
  "إيش الهواية اللي تتمنى تتعلمها؟",
  "آخر كتاب أو مسلسل عجبك؟ 📚",
];
