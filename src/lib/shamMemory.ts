// Sham's conversation memory for the Telegram bot (Palmyra Memory, 2026-10-14). Postgres (prisma/migration_19_sham_memory.sql):
//   sham_chat_memory  every (question, answer) turn per chat — the recent SLIDING WINDOW goes to the Studio with each message
//   sham_user_facts   facts the user stated (name, city, age, work, likes — Arabic rules, no model) + a ROLLING SUMMARY of turns older than the window
// The Studio (ai-system/modelscope-sham/app.py chat_memory) adds its own per-user memory on top (sham_memory.py). «انسَ معلوماتي» deletes both.
// Every database step is best-effort: a database error never blocks a reply. Off with SHAM_MEMORY=0.
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";

export const WINDOW_TURNS = 8;          // turns sent with each message
export const SUMMARY_EVERY = 10;        // turns older than the window are folded into the summary in blocks of this size
const SUMMARY_MAX = 600;

export type Turn = { q: string; a: string };
export type Facts = Record<string, string>;
export type MemoryContext = { chatKey: string; history: Turn[]; summary: string; facts: Facts };
export type Db = { exec: (sql: string, ...args: unknown[]) => Promise<unknown>; query: <T>(sql: string, ...args: unknown[]) => Promise<T[]> };

const prismaDb: Db = {
  exec: (sql, ...args) => prisma.$executeRawUnsafe(sql, ...args),
  query: <T,>(sql: string, ...args: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...args),
};

export function shamMemoryEnabled(): boolean {
  return !["0", "off", "false", "no"].includes((process.env.SHAM_MEMORY || "1").trim().toLowerCase());
}

/** Never the raw chat id in the database or on the Studio: a salted hash. */
export function chatKey(chatId: number | string): string {
  const salt = process.env.SHAM_MEMORY_SALT || "sham-palmyra";
  return "tg:" + createHash("sha256").update(`${salt}|${chatId}`).digest("hex").slice(0, 32);
}

// ---- natural-language rules (the same rules as sham_memory.py on the Studio)
const W = "([^\\s،,.!؟?\\n]+)";
const FACT_RULES: [string, RegExp][] = [
  ["name", new RegExp("(?:^|\\s)و?(?:انا |أنا )?اسمي\\s+" + W)],
  ["name", new RegExp("my name is\\s+" + W, "i")],
  ["city", new RegExp("(?:^|\\s)و?(?:انا من|أنا من|ساكن في|ساكنة في|أسكن في|اسكن في|أعيش في|اعيش في)\\s+" + W)],
  ["age", /(?:^|\s)و?عمري\s+(\d{1,3})/],
  ["job", /(?:^|\s)و?(?:أعمل|اعمل|أشتغل|اشتغل)\s+([^،,.!؟?\n]{2,40})/],
  ["likes", /(?:^|\s)و?(?:أحب|احب|بحب)\s+([^،,.!؟?\n]{2,40})/],
];

export function extractFacts(text: string): Facts {
  const out: Facts = {};
  const t = " " + (text || "").trim();
  for (const [key, rx] of FACT_RULES) {
    if (out[key]) continue;
    const m = t.match(rx);
    const v = m?.[1]?.trim();
    if (v && !["؟", "?"].includes(v) && !/^(ما|شو|ايش|إيش)/.test(v)) out[key] = v;
  }
  return out;
}

const norm = (s: string) =>
  (s || "").trim().toLowerCase().replace(/[\u064B-\u0652]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");

/** «انسَ معلوماتي» «امسح ذاكرتي» «احذف معلوماتي» «forget me» — natural language, no slash command. */
export function isForgetCommand(text: string): boolean {
  const t = norm(text);
  if (/\bforget (me|my|everything)/.test(t)) return true;
  const verbs = ["انس", "امسح", "احذف", "شيل", "امح"];
  const objs = ["معلومات", "ذاكرت", "كل شي", "كل شيء", "عني", "بياناتي", "محادثات"];
  return verbs.some((v) => t.includes(v)) && objs.some((o) => t.includes(o)) && t.length < 80;
}

/** Rolling summary: the previous summary plus the topics of the turns now leaving the window, newest kept when too long. Rule-based on purpose:
 *  the model is still too weak to summarise reliably, and a wrong summary would be worse than a short one. */
export function foldSummary(prev: string, leaving: Turn[]): string {
  const topics = leaving
    .map((t) => t.q.replace(/\s+/g, " ").trim().split(" ").slice(0, 8).join(" "))
    .filter((x) => x.length > 2);
  if (!topics.length) return prev;
  let s = (prev ? prev + " | " : "") + topics.join(" | ");
  while (s.length > SUMMARY_MAX && s.includes(" | ")) s = s.slice(s.indexOf(" | ") + 3);
  return s.slice(-SUMMARY_MAX);
}

let ready: Promise<void> | null = null;
function ensureTables(db: Db): Promise<void> {
  if (db !== prismaDb) return Promise.resolve();
  if (!ready) {
    ready = (async () => {
      await db.exec(`CREATE TABLE IF NOT EXISTS sham_chat_memory (id BIGSERIAL PRIMARY KEY, chat_key TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await db.exec(`CREATE INDEX IF NOT EXISTS sham_chat_memory_chat_idx ON sham_chat_memory (chat_key, id DESC)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS sham_user_facts (chat_key TEXT PRIMARY KEY, facts JSONB NOT NULL DEFAULT '{}'::jsonb, summary TEXT NOT NULL DEFAULT '', summarized_upto BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/** The memory to send with a message (facts already include what THIS message states). Null when off or the database is unreachable. */
export async function loadMemory(chatId: number | string, text: string, db: Db = prismaDb): Promise<MemoryContext | null> {
  if (!shamMemoryEnabled()) return null;
  const key = chatKey(chatId);
  try {
    await ensureTables(db);
    const rows = await db.query<{ question: string; answer: string }>(
      `SELECT question, answer FROM sham_chat_memory WHERE chat_key=$1 ORDER BY id DESC LIMIT ${WINDOW_TURNS}`, key);
    const prof = await db.query<{ facts: Facts | string; summary: string }>(`SELECT facts, summary FROM sham_user_facts WHERE chat_key=$1`, key);
    const stored = prof[0] ? (typeof prof[0].facts === "string" ? JSON.parse(prof[0].facts) : prof[0].facts) || {} : {};
    return {
      chatKey: key,
      history: rows.reverse().map((r) => ({ q: r.question, a: r.answer })),
      summary: prof[0]?.summary || "",
      facts: { ...stored, ...extractFacts(text) },
    };
  } catch {
    return null;
  }
}

/** Store one turn, merge new facts, and fold turns that left the window into the rolling summary. */
export async function saveTurn(chatId: number | string, question: string, answer: string, db: Db = prismaDb): Promise<void> {
  if (!shamMemoryEnabled() || !question.trim() || !answer.trim()) return;
  const key = chatKey(chatId);
  try {
    await ensureTables(db);
    await db.exec(`INSERT INTO sham_chat_memory (chat_key, question, answer) VALUES ($1, $2, $3)`, key, question.slice(0, 4000), answer.slice(0, 4000));
    const prof = await db.query<{ facts: Facts | string; summary: string; summarized_upto: string | number }>(
      `SELECT facts, summary, summarized_upto FROM sham_user_facts WHERE chat_key=$1`, key);
    const stored: Facts = prof[0] ? (typeof prof[0].facts === "string" ? JSON.parse(prof[0].facts) : prof[0].facts) || {} : {};
    const facts = { ...stored, ...extractFacts(question) };
    let summary = prof[0]?.summary || "";
    let upto = Number(prof[0]?.summarized_upto || 0);
    // turns older than the window and not yet summarised, once there are SUMMARY_EVERY of them
    const old = await db.query<{ id: string | number; question: string; answer: string }>(
      `SELECT id, question, answer FROM sham_chat_memory WHERE chat_key=$1 AND id > $2 ORDER BY id DESC OFFSET ${WINDOW_TURNS}`, key, upto);
    if (old.length >= SUMMARY_EVERY) {
      const leaving = old.reverse();
      summary = foldSummary(summary, leaving.map((r) => ({ q: r.question, a: r.answer })));
      upto = Number(leaving[leaving.length - 1].id);
    }
    await db.exec(
      `INSERT INTO sham_user_facts (chat_key, facts, summary, summarized_upto, updated_at) VALUES ($1, $2::jsonb, $3, $4, now())
       ON CONFLICT (chat_key) DO UPDATE SET facts=EXCLUDED.facts, summary=EXCLUDED.summary, summarized_upto=EXCLUDED.summarized_upto, updated_at=now()`,
      key, JSON.stringify(facts), summary, upto);
  } catch {
    /* memory is best-effort: the reply already went out */
  }
}

/** «انسَ معلوماتي»: delete this chat's turns, facts and summary. */
export async function forgetMemory(chatId: number | string, db: Db = prismaDb): Promise<boolean> {
  const key = chatKey(chatId);
  try {
    await ensureTables(db);
    await db.exec(`DELETE FROM sham_chat_memory WHERE chat_key=$1`, key);
    await db.exec(`DELETE FROM sham_user_facts WHERE chat_key=$1`, key);
    return true;
  } catch {
    return false;
  }
}
