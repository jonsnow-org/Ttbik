/**
 * MARRIAGE_BOT hybrid mode — pure helpers (no DB, no network) shared by the
 * inline-query handler, the /start profile_<id> deep link and the Mini App
 * API. Kept side-effect free so they are unit-tested in
 * src/lib/__tests__/matchHybrid.test.ts.
 *
 * Privacy rule for everything built here: a profile leaving the bot (inline
 * result shared into another chat, Mini App card) carries NO name, username,
 * phone, contact value, photo or free-text that could hold contact details.
 * Only: short id, gender, age, country, city, job/education (scrubbed).
 */
import { createHmac, timingSafeEqual } from "crypto";

export type Gender = "MALE" | "FEMALE";

export type InlineFilter = {
  gender?: Gender;
  ageMin?: number;
  ageMax?: number;
  country?: string;
  keywords: string[];
};

const COUNTRY_ALIASES: Record<string, string[]> = {
  "السعودية": ["السعودية", "سعودية", "سعودي", "سعوديه", "saudi", "ksa", "sa"],
  "مصر": ["مصر", "مصري", "مصرية", "egypt", "eg"],
  "الإمارات": ["الإمارات", "الامارات", "اماراتي", "uae", "emirates", "ae"],
  "الكويت": ["الكويت", "كويتي", "kuwait", "kw"],
  "قطر": ["قطر", "قطري", "qatar", "qa"],
  "البحرين": ["البحرين", "بحريني", "bahrain", "bh"],
  "عمان": ["عمان", "عُمان", "عماني", "oman", "om"],
  "اليمن": ["اليمن", "يمني", "yemen", "ye"],
  "العراق": ["العراق", "عراقي", "iraq", "iq"],
  "سوريا": ["سوريا", "سورية", "سوري", "syria", "sy"],
  "الأردن": ["الأردن", "الاردن", "اردني", "jordan", "jo"],
  "فلسطين": ["فلسطين", "فلسطيني", "palestine", "ps"],
  "لبنان": ["لبنان", "لبناني", "lebanon", "lb"],
  "المغرب": ["المغرب", "مغربي", "morocco", "ma"],
  "الجزائر": ["الجزائر", "جزائري", "algeria", "dz"],
  "تونس": ["تونس", "تونسي", "tunisia", "tn"],
  "ليبيا": ["ليبيا", "ليبي", "libya", "ly"],
  "السودان": ["السودان", "سوداني", "sudan", "sd"],
  "تركيا": ["تركيا", "turkey", "türkiye", "tr"],
};

const MALE_WORDS = ["ذكر", "رجل", "شاب", "زوج", "male", "man", "men", "m"];
const FEMALE_WORDS = ["أنثى", "انثى", "امرأة", "امراة", "بنت", "فتاة", "زوجة", "female", "woman", "women", "f"];

const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";
export function normalizeDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}
function normWord(w: string): string {
  return w.trim().toLowerCase().replace(/[إأآ]/g, "ا").replace(/ة(?=\s|$)/g, "ه").replace(/ى(?=\s|$)/g, "ي");
}

/** Resolves a free-text country word to the canonical Arabic name, or null. */
export function resolveCountry(word: string): string | null {
  const n = normWord(word);
  if (!n) return null;
  for (const [canon, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (aliases.some((a) => normWord(a) === n)) return canon;
  }
  return null;
}

/**
 * Parses "@bot مصر 25-30 أنثى طبيبة" / "saudi 22 male" into a filter.
 * Ages outside 18..100 are clamped to 18..100 (18+ only).
 */
export function parseInlineQuery(raw: string): InlineFilter {
  const text = normalizeDigits(String(raw || "")).slice(0, 200);
  const f: InlineFilter = { keywords: [] };
  const range = text.match(/(\d{2})\s*[-–~إلىto]+\s*(\d{2})/);
  let rest = text;
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    f.ageMin = Math.min(a, b);
    f.ageMax = Math.max(a, b);
    rest = rest.replace(range[0], " ");
  }
  const tokens = rest.split(/[\s,،]+/).filter(Boolean);
  for (const t of tokens) {
    const low = t.toLowerCase();
    if (/^\d{2}\+?$/.test(low) && f.ageMin == null) {
      const n = Number(low.replace("+", ""));
      if (low.endsWith("+")) f.ageMin = n;
      else { f.ageMin = n - 2; f.ageMax = n + 2; }
      continue;
    }
    if (!f.gender && MALE_WORDS.includes(normWord(t))) { f.gender = "MALE"; continue; }
    if (!f.gender && FEMALE_WORDS.map(normWord).includes(normWord(t))) { f.gender = "FEMALE"; continue; }
    const c = !f.country ? resolveCountry(t) : null;
    if (c) { f.country = c; continue; }
    if (t.length >= 2 && f.keywords.length < 5) f.keywords.push(t.slice(0, 30));
  }
  if (f.ageMin != null) f.ageMin = Math.max(18, Math.min(100, f.ageMin));
  if (f.ageMax != null) f.ageMax = Math.max(18, Math.min(100, f.ageMax));
  if (f.ageMin != null && f.ageMax != null && f.ageMin > f.ageMax) [f.ageMin, f.ageMax] = [f.ageMax, f.ageMin];
  return f;
}

// --- privacy scrubbing ------------------------------------------------------
const CONTACT_PATTERNS: RegExp[] = [
  /@[a-z0-9_]{3,}/gi, // @usernames
  /\bt\.me\/\S+/gi,
  /\b(?:https?:\/\/|www\.)\S+/gi,
  /\bwa\.me\/\S+/gi,
  /[\w.+-]+@[\w-]+\.[\w.]+/g, // emails
  /\+?\d[\d\s\-()]{6,}\d/g, // phone-like digit runs
  /(?:واتس|واتساب|whatsapp|telegram|تلجرام|تليجرام|انستا|instagram|snap|سناب|رقمي|number)\S*/gi,
];
export function scrubContacts(text: string | null | undefined): string {
  let s = normalizeDigits(String(text || ""));
  for (const re of CONTACT_PATTERNS) s = s.replace(re, "•••");
  return s.replace(/\s+/g, " ").trim();
}

export type PublicProfileSource = {
  id: string; // MatchProfile.id (uuid)
  userId: string;
  gender: string;
  age: number;
  country: string;
  city?: string | null;
  job?: string | null;
  education?: string | null;
  maritalStatus?: string | null;
  verificationStatus?: string | null;
};

/** The ONLY profile shape allowed to leave the bot. No name/contact/photo/attributes. */
export type PublicProfile = {
  ref: string; // MatchProfile.id
  shortId: string;
  gender: Gender;
  age: number;
  country: string;
  city: string | null;
  job: string | null;
  education: string | null;
  maritalStatus: string | null;
  verified: boolean;
};

export function shortRef(id: string): string {
  return id.replace(/-/g, "").slice(0, 8).toUpperCase();
}
const clip = (v: string, n: number) => (v.length > n ? v.slice(0, n - 1) + "…" : v);
const opt = (v: string | null | undefined, n: number) => {
  const s = scrubContacts(v);
  return s ? clip(s, n) : null;
};

export function toPublicProfile(p: PublicProfileSource): PublicProfile {
  return {
    ref: p.id,
    shortId: shortRef(p.id),
    gender: p.gender === "FEMALE" ? "FEMALE" : "MALE",
    age: p.age,
    country: clip(scrubContacts(p.country), 30),
    city: opt(p.city, 30),
    job: opt(p.job, 40),
    education: opt(p.education, 40),
    maritalStatus: opt(p.maritalStatus, 20),
    verified: p.verificationStatus === "VERIFIED",
  };
}

export function matchesFilter(p: PublicProfileSource, f: InlineFilter): boolean {
  if (p.age < 18) return false;
  if (f.gender && p.gender !== f.gender) return false;
  if (f.ageMin != null && p.age < f.ageMin) return false;
  if (f.ageMax != null && p.age > f.ageMax) return false;
  if (f.country && normWord(p.country) !== normWord(f.country) && resolveCountry(p.country) !== f.country) return false;
  if (f.keywords.length) {
    const hay = normWord([p.city, p.job, p.education, p.maritalStatus, p.country].filter(Boolean).join(" "));
    if (!f.keywords.some((k) => hay.includes(normWord(k)))) return false;
  }
  return true;
}

// --- inline results ------------------------------------------------------------
export const INLINE_PAGE_SIZE = 20;
export const PROFILE_START_PREFIX = "profile_";

export function deepLink(botUsername: string, ref: string): string {
  return `https://t.me/${botUsername.replace(/^@/, "")}?start=${PROFILE_START_PREFIX}${ref}`;
}
/** start payload max is 64 chars of [A-Za-z0-9_-]; a uuid fits. */
export function parseProfileStart(payload: string | null | undefined): string | null {
  const m = String(payload || "").match(/^profile_([0-9a-fA-F-]{36})$/);
  return m ? m[1].toLowerCase() : null;
}

export function genderLabel(g: Gender): string {
  return g === "FEMALE" ? "أنثى" : "ذكر";
}

export function publicCardText(p: PublicProfile): string {
  return [
    `💍 ملف #${p.shortId}${p.verified ? " ☑️" : ""}`,
    `${p.gender === "FEMALE" ? "👩" : "👨"} ${genderLabel(p.gender)} · ${p.age} سنة`,
    `🌍 ${p.country}${p.city ? ` · ${p.city}` : ""}`,
    p.job ? `💼 ${p.job}` : null,
    p.education ? `🎓 ${p.education}` : null,
    p.maritalStatus ? `💍 ${p.maritalStatus}` : null,
    "",
    "🔒 التواصل يتم عبر البوت فقط وبموافقة الطرفين. للبالغين 18+.",
  ].filter((l): l is string => l !== null).join("\n");
}

export type InlineArticle = {
  type: "article";
  id: string;
  title: string;
  description: string;
  thumbnail_url?: string;
  input_message_content: { message_text: string };
  reply_markup: { inline_keyboard: { text: string; url: string }[][] };
};

export function buildInlineArticle(p: PublicProfile, botUsername: string, thumbBase: string): InlineArticle {
  const desc = [genderLabel(p.gender), p.job, p.education].filter(Boolean).join(" · ");
  return {
    type: "article",
    id: `p_${p.shortId}_${p.ref.slice(-4)}`.slice(0, 64),
    title: `ملف #${p.shortId} - ${p.country}/${p.age}`,
    description: clip(desc || "ملف متاح للتعارف بغرض الزواج", 120),
    thumbnail_url: `${thumbBase.replace(/\/$/, "")}/img/match-avatar-${p.gender === "FEMALE" ? "f" : "m"}.jpg`,
    input_message_content: { message_text: publicCardText(p) },
    reply_markup: { inline_keyboard: [[{ text: "اضغط للتواصل عبر البوت 🔒", url: deepLink(botUsername, p.ref) }]] },
  };
}

export function paginate<T>(items: T[], offsetRaw: string | undefined, size = INLINE_PAGE_SIZE): { page: T[]; nextOffset: string } {
  const off = Math.max(0, Number.parseInt(String(offsetRaw || "0"), 10) || 0);
  const page = items.slice(off, off + size);
  return { page, nextOffset: off + size < items.length ? String(off + size) : "" };
}

// --- Mini App initData -------------------------------------------------------
export const INIT_DATA_MAX_AGE_S = 24 * 3600;
export type TgWebAppUser = { id: string; firstName?: string; languageCode?: string };

/** Telegram WebApp initData verification (HMAC-SHA256, timing-safe, auth_date freshness). */
export function verifyInitData(initData: string, botToken: string, nowS = Math.floor(Date.now() / 1000), maxAgeS = INIT_DATA_MAX_AGE_S): TgWebAppUser | null {
  if (!initData || !botToken || initData.length > 4096) return null;
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash") || "";
    if (!/^[0-9a-f]{64}$/i.test(hash)) return null;
    params.delete("hash");
    const pairs: string[] = [];
    params.forEach((v, k) => pairs.push(`${k}=${v}`));
    pairs.sort();
    const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
    const computed = createHmac("sha256", secret).update(pairs.join("\n")).digest();
    const given = Buffer.from(hash, "hex");
    if (given.length !== computed.length || !timingSafeEqual(given, computed)) return null;
    const authDate = Number(params.get("auth_date") || 0);
    if (!authDate || nowS - authDate > maxAgeS || authDate - nowS > 300) return null;
    const user = JSON.parse(params.get("user") || "null");
    if (!user?.id) return null;
    return { id: String(user.id), firstName: user.first_name, languageCode: user.language_code };
  } catch {
    return null;
  }
}

/** Test helper / documentation: how Telegram signs initData. */
export function signInitData(fields: Record<string, string>, botToken: string): string {
  const pairs = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort();
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(pairs.join("\n")).digest("hex");
  const p = new URLSearchParams(fields);
  p.set("hash", hash);
  return p.toString();
}

// --- rate limiting (best-effort, per serverless instance) ---------------------
const buckets = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) { buckets.set(key, arr); return false; }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 5000) buckets.clear();
  return true;
}

// --- Mini App form validation -------------------------------------------------
export type ProfileInput = {
  gender: Gender; name: string; age: number; country: string;
  job: string | null; education: string | null; attributes: string | null;
  city: string | null; maritalStatus: string | null;
  contactMethod: "TELEGRAM" | "WHATSAPP"; contactValue: string;
};
const s = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const sn = (v: unknown, n: number) => s(v, n) || null;

export function validateProfileInput(b: any): { ok: true; value: ProfileInput } | { ok: false; error: string } {
  const gender = b?.gender === "FEMALE" ? "FEMALE" : b?.gender === "MALE" ? "MALE" : null;
  if (!gender) return { ok: false, error: "اختر الجنس" };
  const name = s(b.name, 40);
  if (name.length < 2) return { ok: false, error: "الاسم قصير" };
  const age = Number(normalizeDigits(String(b.age ?? "")));
  if (!Number.isInteger(age) || age < 18 || age > 100) return { ok: false, error: "العمر يجب أن يكون 18 فأكثر" };
  const country = s(b.country, 40);
  if (!country) return { ok: false, error: "اكتب الدولة" };
  const contactMethod = b.contactMethod === "WHATSAPP" ? "WHATSAPP" : "TELEGRAM";
  const contactValue = s(b.contactValue, 40);
  if (contactMethod === "TELEGRAM" && !/^@?[A-Za-z0-9_]{5,32}$/.test(contactValue)) return { ok: false, error: "معرّف تلجرام غير صالح" };
  if (contactMethod === "WHATSAPP" && normalizeDigits(contactValue).replace(/\D/g, "").length < 8) return { ok: false, error: "رقم واتساب غير صالح" };
  return {
    ok: true,
    value: {
      gender, name, age, country, contactMethod, contactValue,
      job: sn(b.job, 80), education: sn(b.education, 80), attributes: sn(b.attributes, 500),
      city: sn(b.city, 40), maritalStatus: sn(b.maritalStatus, 30),
    },
  };
}

export type PrefInput = { country: string; ageMin: number | null; ageMax: number | null; job: string | null; education: string | null; attributes: string | null };
export function validatePrefInput(b: any): { ok: true; value: PrefInput } | { ok: false; error: string } {
  const country = s(b?.country, 40);
  if (!country) return { ok: false, error: "الدولة مطلوبة" };
  const num = (v: unknown) => { const n = Number(normalizeDigits(String(v ?? ""))); return v === "" || v == null || !Number.isFinite(n) ? null : Math.max(18, Math.min(100, Math.round(n))); };
  let ageMin = num(b.ageMin), ageMax = num(b.ageMax);
  if (ageMin != null && ageMax != null && ageMin > ageMax) [ageMin, ageMax] = [ageMax, ageMin];
  return { ok: true, value: { country, ageMin, ageMax, job: sn(b.job, 80), education: sn(b.education, 80), attributes: sn(b.attributes, 200) } };
}
