import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";

/**
 * «بَشَر» — a chat that looks like an AI assistant, but every answer is
 * written by a real, random human visitor within ANSWER_SECONDS. To ask you
 * spend a credit; you earn credits by answering someone else. Inspired by the
 * mechanic of "Your AI Slop Bores Me" (2026), rebuilt for Arabic with the
 * answerer's country shown.
 *
 * Storage: two plain tables created on first use with CREATE TABLE IF NOT
 * EXISTS through the app's own Postgres connection (DATABASE_URL), so nothing
 * has to be run by hand. The same SQL is in supabase/migration_bashar.sql.
 */

export const ANSWER_SECONDS = 75;
const CLAIM_GRACE_SECONDS = 8; // network slack after the visible countdown
const QUESTION_TTL_MINUTES = 6; // unanswered after this → expired + refund
export const MAX_CREDITS = 3;
const REGEN_MINUTES = 10; // +1 free credit every 10 minutes, up to MAX_CREDITS
const HIDE_AFTER_REPORTS = 2;
export const MAX_LEN = 280;

let ready: Promise<void> | null = null;

export function ensureTables(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS bashar_players (
          id text PRIMARY KEY,
          credits int NOT NULL DEFAULT 1,
          credits_at timestamptz NOT NULL DEFAULT now(),
          answered int NOT NULL DEFAULT 0,
          last_seen timestamptz NOT NULL DEFAULT now(),
          created_at timestamptz NOT NULL DEFAULT now()
        )`);
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS bashar_questions (
          id text PRIMARY KEY,
          asker text NOT NULL,
          asker_cc text,
          body text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          claimed_by text,
          claimed_at timestamptz,
          answer text,
          answerer text,
          answer_cc text,
          answered_at timestamptz,
          expired boolean NOT NULL DEFAULT false,
          reports int NOT NULL DEFAULT 0,
          hidden boolean NOT NULL DEFAULT false
        )`);
      // Supabase exposes public tables to its anon REST API; RLS with no
      // policies blocks that. The app's own table-owner connection is unaffected.
      await prisma.$executeRawUnsafe(`ALTER TABLE bashar_players ENABLE ROW LEVEL SECURITY`);
      await prisma.$executeRawUnsafe(`ALTER TABLE bashar_questions ENABLE ROW LEVEL SECURITY`);
      await prisma.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS bashar_q_open ON bashar_questions (created_at) WHERE answer IS NULL AND expired = false`,
      );
    })().catch((e) => {
      ready = null; // retry on the next request
      throw e;
    });
  }
  return ready;
}

export function newId() {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}

// ---------------------------------------------------------------- moderation
// No links, handles or phone numbers (spam/contact harvesting) and a short
// list of common Arabic/English insults. Reports hide anything else.
const BAD = [
  "كس", "زب", "شرموط", "منيوك", "قحب", "عرص", "متناك", "نيك", "خول", "لبوه",
  "fuck", "shit", "bitch", "porn", "sex",
];

export function cleanText(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "النص مطلوب" };
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < 2) return { ok: false, error: "النص قصير جداً" };
  if (text.length > MAX_LEN) return { ok: false, error: `الحد ${MAX_LEN} حرفاً` };
  if (/(https?:\/\/|www\.|\.com\b|\.net\b|t\.me|@\w{3,})/i.test(text)) return { ok: false, error: "الروابط والمعرّفات غير مسموحة" };
  if (/(\d[\s-]?){8,}/.test(text)) return { ok: false, error: "أرقام الهواتف غير مسموحة" };
  const norm = text.toLowerCase().replace(/[ً-ْـ]/g, "");
  const words = norm.split(/[^\p{L}]+/u);
  if (words.some((w) => BAD.some((b) => w === b || (b.length >= 4 && w.includes(b))))) {
    return { ok: false, error: "من فضلك بدون ألفاظ مسيئة" };
  }
  return { ok: true, text };
}

// ------------------------------------------------------------------ players
type PlayerRow = { id: string; credits: number; credits_at: Date; answered: number };

/** Loads (or creates) the player and applies lazy credit regeneration. */
export async function touchPlayer(id: string): Promise<PlayerRow> {
  await ensureTables();
  const rows = await prisma.$queryRawUnsafe<PlayerRow[]>(
    `INSERT INTO bashar_players (id) VALUES ($1)
     ON CONFLICT (id) DO UPDATE SET last_seen = now()
     RETURNING id, credits, credits_at, answered`,
    id,
  );
  const p = rows[0];
  if (p.credits < MAX_CREDITS) {
    const gained = Math.floor((Date.now() - new Date(p.credits_at).getTime()) / (REGEN_MINUTES * 60_000));
    if (gained > 0) {
      const credits = Math.min(MAX_CREDITS, p.credits + gained);
      const upd = await prisma.$queryRawUnsafe<PlayerRow[]>(
        `UPDATE bashar_players SET credits = $2, credits_at = now() WHERE id = $1 RETURNING id, credits, credits_at, answered`,
        id,
        credits,
      );
      return upd[0];
    }
  }
  return p;
}

export async function onlineCount(): Promise<number> {
  const r = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM bashar_players WHERE last_seen > now() - interval '2 minutes'`,
  );
  return Number(r[0]?.n ?? 0);
}

// ---------------------------------------------------------------- questions
export async function expireStale() {
  // Refund askers whose question nobody answered in time.
  await prisma.$executeRawUnsafe(`
    WITH ex AS (
      UPDATE bashar_questions SET expired = true
      WHERE answer IS NULL AND expired = false AND created_at < now() - interval '${QUESTION_TTL_MINUTES} minutes'
      RETURNING asker
    )
    UPDATE bashar_players p SET credits = LEAST(${MAX_CREDITS}, p.credits + c.n)
    FROM (SELECT asker, count(*)::int AS n FROM ex GROUP BY asker) c
    WHERE p.id = c.asker`);
}

export async function ask(player: string, body: string, cc: string | null) {
  const spent = await prisma.$queryRawUnsafe<{ credits: number }[]>(
    `UPDATE bashar_players SET credits = credits - 1,
       credits_at = CASE WHEN credits >= ${MAX_CREDITS} THEN now() ELSE credits_at END
     WHERE id = $1 AND credits > 0 RETURNING credits`,
    player,
  );
  if (!spent.length) return { ok: false as const, error: "no_credits" };
  const id = newId();
  await prisma.$executeRawUnsafe(
    `INSERT INTO bashar_questions (id, asker, asker_cc, body) VALUES ($1, $2, $3, $4)`,
    id,
    player,
    cc,
    body,
  );
  return { ok: true as const, id, credits: spent[0].credits };
}

export type QuestionView = {
  id: string;
  body: string;
  asker_cc: string | null;
  answer: string | null;
  answer_cc: string | null;
  expired: boolean;
  hidden: boolean;
  created_at: Date;
  answered_at: Date | null;
  mine?: boolean;
};

export async function getQuestion(id: string): Promise<(QuestionView & { asker: string }) | null> {
  await ensureTables();
  const r = await prisma.$queryRawUnsafe<(QuestionView & { asker: string })[]>(
    `SELECT id, asker, body, asker_cc, answer, answer_cc, expired, hidden, created_at, answered_at
     FROM bashar_questions WHERE id = $1`,
    id,
  );
  return r[0] ?? null;
}

/** Atomically hands the oldest open question (not the player's own) to the player. */
export async function claim(player: string) {
  const r = await prisma.$queryRawUnsafe<{ id: string; body: string; asker_cc: string | null; claimed_at: Date }[]>(
    `UPDATE bashar_questions SET claimed_by = $1, claimed_at = now()
     WHERE id = (
       SELECT id FROM bashar_questions
       WHERE answer IS NULL AND expired = false AND hidden = false AND asker <> $1
         AND (claimed_by IS NULL OR claimed_at < now() - interval '${ANSWER_SECONDS + CLAIM_GRACE_SECONDS} seconds')
       ORDER BY created_at LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, body, asker_cc, claimed_at`,
    player,
  );
  return r[0] ?? null;
}

export async function answer(player: string, id: string, text: string, cc: string | null) {
  const r = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `UPDATE bashar_questions SET answer = $3, answerer = $1, answer_cc = $4, answered_at = now()
     WHERE id = $2 AND claimed_by = $1 AND answer IS NULL AND expired = false
       AND claimed_at > now() - interval '${ANSWER_SECONDS + CLAIM_GRACE_SECONDS} seconds'
     RETURNING id`,
    player,
    id,
    text,
    cc,
  );
  if (!r.length) return { ok: false as const, error: "late" };
  const p = await prisma.$queryRawUnsafe<{ credits: number }[]>(
    `UPDATE bashar_players SET credits = LEAST(${MAX_CREDITS}, credits + 1), answered = answered + 1 WHERE id = $1 RETURNING credits`,
    player,
  );
  return { ok: true as const, credits: p[0]?.credits ?? 0 };
}

/** Frees a claim early (skip), so the question goes to the next person now. */
export async function release(player: string, id: string) {
  await prisma.$executeRawUnsafe(
    `UPDATE bashar_questions SET claimed_by = NULL, claimed_at = NULL WHERE id = $1 AND claimed_by = $2 AND answer IS NULL`,
    id,
    player,
  );
}

export async function report(id: string) {
  await prisma.$executeRawUnsafe(
    `UPDATE bashar_questions SET reports = reports + 1, hidden = (reports + 1 >= ${HIDE_AFTER_REPORTS}) WHERE id = $1`,
    id,
  );
}

export async function recentAnswered(limit = 12): Promise<QuestionView[]> {
  await ensureTables();
  return prisma.$queryRawUnsafe<QuestionView[]>(
    `SELECT id, body, asker_cc, answer, answer_cc, expired, hidden, created_at, answered_at
     FROM bashar_questions WHERE answer IS NOT NULL AND hidden = false
     ORDER BY answered_at DESC LIMIT ${Math.max(1, Math.min(50, limit))}`,
  );
}

export async function stats() {
  const r = await prisma.$queryRawUnsafe<{ answered: bigint; waiting: bigint }[]>(
    `SELECT
       count(*) FILTER (WHERE answer IS NOT NULL)::bigint AS answered,
       count(*) FILTER (WHERE answer IS NULL AND expired = false)::bigint AS waiting
     FROM bashar_questions`,
  );
  return { answered: Number(r[0]?.answered ?? 0), waiting: Number(r[0]?.waiting ?? 0) };
}

// ------------------------------------------------------------------ country
export function countryLabel(cc: string | null | undefined): string {
  if (!cc || !/^[A-Z]{2}$/.test(cc)) return "🌍 مكان ما";
  const flag = String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  let name = cc;
  try {
    name = new Intl.DisplayNames(["ar"], { type: "region" }).of(cc) ?? cc;
  } catch {
    // keep the code
  }
  return `${flag} ${name}`;
}
