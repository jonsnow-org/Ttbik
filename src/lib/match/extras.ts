/**
 * Mini-app extras (2026-10-18, owner order): Telegram-account verification, the values quiz, invite limits.
 * Everything here is ADDITIVE: small tables created on first use (like appStore.ts), no change to prisma/schema.prisma,
 * and no change to the existing 💞 compatibility percent (the quiz adds its own separate chip when both people answered).
 */
import { prisma } from "@/lib/prisma";
import { callGroq } from "@/lib/groq";

let ready: Promise<void> | null = null;
const DDL = [
  `CREATE TABLE IF NOT EXISTS match_identity (user_id TEXT PRIMARY KEY, method TEXT NOT NULL, has_username BOOLEAN NOT NULL DEFAULT false, premium BOOLEAN NOT NULL DEFAULT false, at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS match_quiz (user_id TEXT PRIMARY KEY, answers JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS match_why (pair TEXT PRIMARY KEY, text TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS match_referral_log (referred_id TEXT PRIMARY KEY, referrer_id TEXT NOT NULL, granted_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS match_referral_log_referrer_idx ON match_referral_log (referrer_id, granted_at DESC)`,
  `CREATE TABLE IF NOT EXISTS match_voice (id BIGSERIAL PRIMARY KEY, session_id TEXT NOT NULL, sender_id TEXT NOT NULL, mime TEXT NOT NULL, dur INT NOT NULL, data BYTEA NOT NULL, keep_until TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS match_voice_session_idx ON match_voice (session_id)`,
  `CREATE TABLE IF NOT EXISTS match_gifts (id BIGSERIAL PRIMARY KEY, sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL, gift TEXT NOT NULL, price NUMERIC NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS match_gifts_recipient_idx ON match_gifts (recipient_id, id DESC)`,
];
export function ensureExtras(): Promise<void> {
  if (!ready) ready = (async () => { for (const s of DDL) await prisma.$executeRawUnsafe(s); })().catch((e) => { ready = null; throw e; });
  return ready;
}

// ---------- Telegram-account verification (instead of sharing a phone number) ----------
/** A Telegram account counts as verified here when Telegram itself vouched for it (signed Mini App data) and it is not an empty shell: it has a public @username or Telegram Premium. */
export function telegramTrust(u: { username?: string | null; isPremium?: boolean }): { ok: boolean; hasUsername: boolean; premium: boolean } {
  const hasUsername = !!u.username, premium = !!u.isPremium;
  return { ok: hasUsername || premium, hasUsername, premium };
}
export async function identityOf(userId: string): Promise<{ method: string; premium: boolean } | null> {
  await ensureExtras();
  const r = await prisma.$queryRawUnsafe<{ method: string; premium: boolean }[]>(`SELECT method, premium FROM match_identity WHERE user_id=$1`, userId);
  return r[0] ?? null;
}
export async function identitiesOf(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  await ensureExtras();
  const r = await prisma.$queryRawUnsafe<{ user_id: string }[]>(`SELECT user_id FROM match_identity WHERE user_id = ANY($1::text[])`, ids);
  return new Set(r.map((x) => x.user_id));
}
/** Marks the account verified without storing any phone number. Returns false when the account does not pass the trust check. */
export async function verifyByTelegram(userId: string, u: { username?: string | null; isPremium?: boolean }): Promise<boolean> {
  const t = telegramTrust(u);
  if (!t.ok) return false;
  await ensureExtras();
  await prisma.$executeRawUnsafe(`INSERT INTO match_identity (user_id, method, has_username, premium) VALUES ($1,'telegram',$2,$3) ON CONFLICT (user_id) DO UPDATE SET has_username=$2, premium=$3`, userId, t.hasUsername, t.premium);
  await prisma.matchUser.update({ where: { id: userId }, data: { phoneVerified: true } });
  return true;
}

// ---------- values quiz ----------
export type QuizQ = { id: string; q: string; options: string[]; ordinal: boolean };
export const QUIZ: QuizQ[] = [
  { id: "faith", q: "مكانة الالتزام الديني في حياتك؟", options: ["ملتزم جداً", "معتدل", "مرن"], ordinal: true },
  { id: "kids", q: "الأطفال بعد الزواج؟", options: ["أريدهم قريباً", "بعد بضع سنوات", "لا أفضّل"], ordinal: true },
  { id: "home", q: "أين تتخيل بيتك؟", options: ["في بلدي الحالي", "أنتقل لبلد آخر", "مرن"], ordinal: false },
  { id: "work", q: "العمل بعد الزواج؟", options: ["يعمل الطرفان", "طرف واحد فقط", "نتفق لاحقاً"], ordinal: false },
  { id: "style", q: "أسلوب الحياة الأقرب إليك؟", options: ["هادئ ومنزلي", "اجتماعي ونشيط", "متوازن"], ordinal: false },
  { id: "conflict", q: "عند الخلاف؟", options: ["أتحدث فوراً", "أحتاج وقتاً أولاً", "أستعين بكبير العائلة"], ordinal: false },
];
export function validQuizAnswers(a: unknown): a is number[] {
  return Array.isArray(a) && a.length === QUIZ.length && a.every((v, i) => Number.isInteger(v) && v >= 0 && v < QUIZ[i].options.length);
}
export async function saveQuiz(userId: string, answers: number[]): Promise<void> {
  await ensureExtras();
  await prisma.$executeRawUnsafe(`INSERT INTO match_quiz (user_id, answers) VALUES ($1,$2::jsonb) ON CONFLICT (user_id) DO UPDATE SET answers=$2::jsonb, updated_at=now()`, userId, JSON.stringify(answers));
  await prisma.$executeRawUnsafe(`DELETE FROM match_why WHERE pair LIKE $1 OR pair LIKE $2`, `${userId}|%`, `%|${userId}`);
}
export async function quizOf(ids: string[]): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (!ids.length) return out;
  await ensureExtras();
  const rows = await prisma.$queryRawUnsafe<{ user_id: string; answers: number[] }[]>(`SELECT user_id, answers FROM match_quiz WHERE user_id = ANY($1::text[])`, ids);
  for (const r of rows) if (validQuizAnswers(r.answers)) out.set(r.user_id, r.answers);
  return out;
}
/** 0-100: same answer = 1; on the ordered questions one step apart = 0.5. */
export function valuesPercent(a: number[], b: number[]): number {
  let sum = 0;
  QUIZ.forEach((q, i) => { const d = Math.abs(a[i] - b[i]); sum += d === 0 ? 1 : q.ordinal && d === 1 ? 0.5 : 0; });
  return Math.round((sum / QUIZ.length) * 100);
}
const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
/** A short friendly reason for a match, from the shared answers only (no names, no personal data). The AI polishes it when available; the plain version is always ready. */
export async function explainWhy(me: string, other: string, a: number[], b: number[]): Promise<string> {
  await ensureExtras();
  const key = pairKey(me, other);
  const hit = await prisma.$queryRawUnsafe<{ text: string }[]>(`SELECT text FROM match_why WHERE pair=$1`, key);
  if (hit[0]) return hit[0].text;
  const shared = QUIZ.filter((_, i) => a[i] === b[i]).map((q, _i) => `${q.q.replace("؟", "")}: ${q.options[a[QUIZ.indexOf(q)]]}`);
  const plain = shared.length ? `تتفقان في: ${shared.slice(0, 3).join(" · ")}.` : "أجوبتكما مختلفة، وقد يكون التكامل جميلاً إن تحدثتما بصراحة.";
  let text = plain;
  try {
    const ai = await Promise.race([
      callGroq("اكتب جملتين عربيتين قصيرتين ودودتين فقط تشرحان سبب انسجام شخصين من الأمور المشتركة المعطاة. بلا أسماء ولا وعود ولا نصائح دينية أو مالية.", plain, 120),
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000)),
    ]);
    const t = ai.trim();
    if (t && t.length < 300 && !/[A-Za-z]{6,}/.test(t)) text = t;
  } catch { /* the plain sentence stays */ }
  await prisma.$executeRawUnsafe(`INSERT INTO match_why (pair, text) VALUES ($1,$2) ON CONFLICT (pair) DO NOTHING`, key, text);
  return text;
}

// ---------- invites: free boosts, with limits ----------
/** At most this many invite rewards per person in any 30 days, so invites never replace buying the boost. */
export const REFERRAL_REWARDS_PER_30D = 3;
export async function referralRewardAllowed(referrerId: string, referredId: string): Promise<boolean> {
  await ensureExtras();
  const done = await prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM match_referral_log WHERE referrer_id=$1 AND granted_at > now() - interval '30 days'`, referrerId);
  if ((done[0]?.n ?? 0) >= REFERRAL_REWARDS_PER_30D) return false;
  const ins = await prisma.$executeRawUnsafe(`INSERT INTO match_referral_log (referred_id, referrer_id) VALUES ($1,$2) ON CONFLICT (referred_id) DO NOTHING`, referredId, referrerId);
  return Number(ins) > 0;
}
export async function inviteStats(userId: string): Promise<{ rewardsLast30d: number; cap: number; joined: number }> {
  await ensureExtras();
  const [r, j] = await Promise.all([
    prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM match_referral_log WHERE referrer_id=$1 AND granted_at > now() - interval '30 days'`, userId),
    prisma.matchUser.count({ where: { referredBy: userId } }),
  ]);
  return { rewardsLast30d: r[0]?.n ?? 0, cap: REFERRAL_REWARDS_PER_30D, joined: j };
}


// ---------- anonymous voice notes (between two people who are both in the app) ----------
export const VOICE_MAX_SECONDS = 30;
export const VOICE_MAX_BYTES = 350_000;
const VOICE_PER_SESSION = 12;
const VOICE_MIMES = /^audio\/(webm|ogg|mp4|mpeg|aac|x-m4a)(;.*)?$/i;
export const voiceMarker = (id: number | bigint, dur: number) => `🎤voice:${id}:${dur}`;

export async function saveVoice(sessionId: string, senderId: string, mime: string, dur: number, b64: string): Promise<{ ok: true; id: number } | { ok: false; error: string }> {
  if (!VOICE_MIMES.test(mime)) return { ok: false, error: "صيغة الصوت غير مدعومة" };
  if (!(dur >= 1 && dur <= VOICE_MAX_SECONDS)) return { ok: false, error: `الرسالة الصوتية حتى ${VOICE_MAX_SECONDS} ثانية` };
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 200 || buf.length > VOICE_MAX_BYTES) return { ok: false, error: "حجم الرسالة الصوتية غير مقبول" };
  await ensureExtras();
  const n = await prisma.$queryRawUnsafe<{ n: number; last: Date | null }[]>(`SELECT COUNT(*)::int AS n, MAX(created_at) AS last FROM match_voice WHERE session_id=$1`, sessionId);
  if ((n[0]?.n ?? 0) >= VOICE_PER_SESSION) return { ok: false, error: "بلغتَ حد الرسائل الصوتية في هذه المحادثة" };
  if (n[0]?.last && Date.now() - new Date(n[0].last).getTime() < 8000) return { ok: false, error: "انتظر لحظات قبل رسالة صوتية أخرى" };
  const r = await prisma.$queryRawUnsafe<{ id: bigint }[]>(`INSERT INTO match_voice (session_id, sender_id, mime, dur, data) VALUES ($1,$2,$3,$4,$5) RETURNING id`, sessionId, senderId, mime.split(";")[0], dur, buf);
  return { ok: true, id: Number(r[0].id) };
}
export async function getVoice(id: number, sessionId: string): Promise<{ mime: string; b64: string } | null> {
  await ensureExtras();
  const r = await prisma.$queryRawUnsafe<{ mime: string; data: Buffer }[]>(`SELECT mime, data FROM match_voice WHERE id=$1 AND session_id=$2`, id, sessionId);
  return r[0] ? { mime: r[0].mime, b64: Buffer.from(r[0].data).toString("base64") } : null;
}
/** The voice notes disappear when the conversation ends; a reported conversation keeps its notes 7 days so an admin can listen. */
export async function endVoice(sessionId: string): Promise<void> {
  try { await ensureExtras(); await prisma.$executeRawUnsafe(`DELETE FROM match_voice WHERE session_id=$1 AND (keep_until IS NULL OR keep_until < now())`, sessionId); } catch { /* best effort */ }
}
export async function keepVoiceForReview(sessionId: string): Promise<void> {
  try { await ensureExtras(); await prisma.$executeRawUnsafe(`UPDATE match_voice SET keep_until = now() + interval '7 days' WHERE session_id=$1`, sessionId); } catch { /* best effort */ }
}
export async function sweepVoice(): Promise<void> {
  try { await ensureExtras(); await prisma.$executeRawUnsafe(`DELETE FROM match_voice WHERE (keep_until IS NULL AND created_at < now() - interval '1 day') OR keep_until < now()`); } catch { /* best effort */ }
}


// ---------- virtual gifts between matched people (paid from the member's balance, which can be topped up with Telegram Stars) ----------
export const GIFTS = [
  { key: "rose", emoji: "🌹", name: "وردة", price: 0.5 },
  { key: "teddy", emoji: "🧸", name: "دبدوب", price: 1 },
  { key: "heart", emoji: "💝", name: "قلب", price: 1.5 },
  { key: "ring", emoji: "💍", name: "خاتم", price: 3 },
  { key: "crown", emoji: "👑", name: "تاج", price: 5 },
] as const;
export type GiftKey = (typeof GIFTS)[number]["key"];
export const giftOf = (k: string) => GIFTS.find((g) => g.key === k) ?? null;
export async function recordGift(sender: string, recipient: string, gift: string, price: number): Promise<void> {
  await ensureExtras();
  await prisma.$executeRawUnsafe(`INSERT INTO match_gifts (sender_id, recipient_id, gift, price) VALUES ($1,$2,$3,$4)`, sender, recipient, gift, price);
}
export async function giftsReceived(userId: string): Promise<Record<string, number>> {
  await ensureExtras();
  const r = await prisma.$queryRawUnsafe<{ gift: string; n: number }[]>(`SELECT gift, COUNT(*)::int AS n FROM match_gifts WHERE recipient_id=$1 GROUP BY gift`, userId);
  return Object.fromEntries(r.map((x) => [x.gift, x.n]));
}
