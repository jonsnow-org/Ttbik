/**
 * Premium Mini App logic for MARRIAGE_BOT — pure, deterministic, unit-tested
 * (src/lib/__tests__/matchPremium.test.ts). No DB / network here.
 */
import { resolveCountry } from "@/lib/match/inline";

const n = (v?: string | null) => (v || "").trim().toLowerCase();
const sameCountry = (a?: string | null, b?: string | null) => !!a && !!b && (n(a) === n(b) || (resolveCountry(a) ?? "x") === (resolveCountry(b) ?? "y"));

// ---- limits ------------------------------------------------------------------
// Anti-spam only (compliments grant nothing).
export const COMPLIMENTS_PER_DAY = 5;
export const SUPERLIKE_NOTE_MAX = 200;

export function dayKey(d = new Date()): string {
  // Day boundary in UTC+3 (owner's timezone, also most of the audience).
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);
}

// Compatibility, prices, VIP and every paid entitlement come from the bot's own
// system (matchBotLogic.compatibilityPercent + src/lib/match/entitlements.ts).
// The earlier app-only spin wheel, referral-VIP and free daily super likes /
// anon-chat quotas were removed so the app never grants privileges the bot
// does not sell.

// ---- reveal consent ----------------------------------------------------------------
/** contactRequestedBy is RandomChatSession's existing column. */
/** REVIEW (owner 2026-10-14): no longer used by the app — the anon chat now uses the bot's 15-message «📇» flow. Kept, not deleted. */
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

/** REVIEW (owner 2026-10-14): «✨ كسر الجليد» removed from the app (the bot has no such button). Kept, not deleted. */
export const ICEBREAKERS = [
  "لو تقدر تعيش في أي مدينة بالعالم، وين تختار؟ 🌍",
  "إيش أكثر شي يخليك تبتسم في يومك؟ 😊",
  "إيش الصفة اللي تشوفها أهم شي في شريك الحياة؟",
  "قهوة ولا شاي؟ ☕🍵",
  "إيش الهواية اللي تتمنى تتعلمها؟",
  "آخر كتاب أو مسلسل عجبك؟ 📚",
];
