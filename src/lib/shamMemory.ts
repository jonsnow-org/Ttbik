// Sham's conversation memory for the Telegram bot (Palmyra Memory, 2026-10-14). Postgres (prisma/migration_19_sham_memory.sql):
//   sham_chat_memory  every (question, answer) turn per chat — the recent SLIDING WINDOW goes to the Studio with each message
//   sham_user_facts   facts the user stated (name, city, age, work, likes — Arabic rules, no model) + a ROLLING SUMMARY of turns older than the window
// The Studio (ai-system/modelscope-sham/app.py chat_memory) adds its own per-user memory on top (sham_memory.py). «انسَ معلوماتي» deletes both.
// Every database step is best-effort: a database error never blocks a reply. Off with SHAM_MEMORY=0.
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";

export const WINDOW_TURNS = 8;          // turns sent with each message
export const SESSION_GAP_MIN = Number(process.env.SHAM_MEMORY_SESSION_GAP_MIN || 90);   // a pause longer than this starts a new conversation
export const SUMMARY_EVERY = 10;        // turns older than the window are folded into the summary in blocks of this size
const SUMMARY_MAX = 600;

export type Turn = { q: string; a: string };
export type Facts = Record<string, string>;
/** The user's own switches for this Sham (Mini App → memory): learn facts, use what was learned, keep the conversation. Undefined = all on. */
export type MemoryOpts = { remember?: boolean; recall?: boolean; save?: boolean };
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

/** The key under which ONE named conversation's turns are stored (the chat list): never equal to the user-level key, which keeps facts and the legacy single stream. */
export function scopeKey(chatId: number | string, variant: string, threadId: string): string {
  return `${chatKey(chatId)}|${variant}|${threadId}`;
}

/** Model-specific user facts/summary and the memory key sent to the matching Sham Studio. */
export function modelMemoryKey(chatId: number | string, variant: "v1" | "v2"): string {
  return `${chatKey(chatId)}|${variant}`;
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

// 2026-10-17 (supervisor): a fact comes only from a STATEMENT — «هل أحب القهوة؟» or «أحب أن أسألك عن…» used to store a "like" — and a job / like is a short phrase.
const LOOSE_KEYS = new Set(["job", "likes"]);
const isQuestionText = (t: string) => /[؟?]/.test(t) || /^\s*(هل|ما|ماذا|لماذا|كيف|متى|اين|أين|من|كم)\s/.test(t);
const BAD_FACT_START = /^(أن|ان|ما|لا|اسأل|اسال|أسأل|ان\s|أن\s|الا|إلا|كثيرا|جدا)/;

export function extractFacts(text: string): Facts {
  const out: Facts = {};
  const t = " " + (text || "").trim();
  if (isQuestionText(t)) return out;
  for (const [key, rx] of FACT_RULES) {
    if (out[key]) continue;
    const m = t.match(rx);
    const v = m?.[1]?.trim();
    if (!v || ["؟", "?"].includes(v) || /^(ما|شو|ايش|إيش)/.test(v)) continue;
    if (LOOSE_KEYS.has(key) && (v.split(/\s+/).length > 4 || BAD_FACT_START.test(v))) continue;
    out[key] = v;
  }
  return out;
}

const norm = (s: string) =>
  (s || "").trim().toLowerCase().replace(/[\u064B-\u0652]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");

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

const readyBy = new WeakMap<object, Promise<void>>();
export function ensureTables(db: Db): Promise<void> {
  if (db !== prismaDb && !(db as { ddl?: boolean }).ddl) return Promise.resolve();   // `ddl: true` = a real SQL engine in tests
  let ready = readyBy.get(db) || null;
  if (!ready) {
    ready = (async () => {
      await db.exec(`CREATE TABLE IF NOT EXISTS sham_chat_memory (id BIGSERIAL PRIMARY KEY, chat_key TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await db.exec(`CREATE INDEX IF NOT EXISTS sham_chat_memory_chat_idx ON sham_chat_memory (chat_key, id DESC)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS sham_user_facts (chat_key TEXT PRIMARY KEY, facts JSONB NOT NULL DEFAULT '{}'::jsonb, summary TEXT NOT NULL DEFAULT '', summarized_upto BIGINT NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    })().catch((e) => { readyBy.delete(db); throw e; });
    readyBy.set(db, ready);
  }
  return ready;
}

// 2026-10-15 (owner, repetition fix — additive): a weak checkpoint copies its own earlier replies from the window, and a repeated reply was
// stored and sent back again. SHAM_MEMORY_DEDUPE=0 / SHAM_MEMORY_SEND_REPLIES=1 restore the old behaviour.
export function normReply(s: string): string {
  return (s || "").replace(/[\u064B-\u0652\u0640]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
}
export function nearSameReply(a: string, b: string): boolean {
  const x = normReply(a), y = normReply(b);
  if (!x || !y) return false;
  if (x === y || (Math.min(x.length, y.length) >= 12 && (x.includes(y) || y.includes(x)))) return true;
  const wa = new Set(x.split(" ")), wb = new Set(y.split(" "));
  let common = 0;
  wa.forEach((w) => { if (wb.has(w)) common++; });
  return common / Math.max(wa.size, wb.size) >= 0.8;
}
const dedupeOn = () => process.env.SHAM_MEMORY_DEDUPE !== "0";
const sendRepliesOn = () => process.env.SHAM_MEMORY_SEND_REPLIES === "1";
export function cleanHistory(turns: Turn[], withReplies = false): Turn[] {
  let out = turns;
  if (dedupeOn()) {
    const seen: string[] = [];
    out = out.map((t) => {
      const dup = seen.some((s) => nearSameReply(s, t.a));
      seen.push(t.a);
      return dup ? { q: t.q, a: "" } : t;
    });
  }
  return sendRepliesOn() || withReplies ? out : out.map((t) => ({ q: t.q, a: "" }));
}

const STOP = new Set(["هذا", "هذه", "ذلك", "التي", "الذي", "على", "الى", "إلى", "عن", "في", "من", "ما", "هل", "كيف", "ماذا", "لماذا", "أنا", "انا", "انت", "أنت", "لي", "لك", "مع", "كان", "يكون", "هو", "هي", "the", "and", "for", "you", "what", "how"]);
const words = (s: string) => new Set(norm(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !STOP.has(w)));

/** Turns from the CURRENT conversation only (newest first in, oldest first out): it ends where a pause longer than SESSION_GAP_MIN begins.
 *  Rows without a timestamp count as current. */
export function currentSession<T extends { created_at?: Date | string | null }>(rowsNewestFirst: T[], now = Date.now()): { current: T[]; older: T[] } {
  const gapMs = SESSION_GAP_MIN * 60_000;
  let prev = now, i = 0;
  for (; i < rowsNewestFirst.length; i++) {
    const at = rowsNewestFirst[i].created_at ? new Date(rowsNewestFirst[i].created_at as string).getTime() : NaN;
    if (!Number.isNaN(at)) {
      if (prev - at > gapMs) break;
      prev = at;
    }
  }
  return { current: rowsNewestFirst.slice(0, i), older: rowsNewestFirst.slice(i) };
}

/** Earlier conversations enter only when they are about the same thing as this message (at least two shared content words): the user's own earlier
 *  questions, as one short line. This replaces the old rolling summary (the first words of every old question), which the model parroted in
 *  unrelated chats. SHAM_MEMORY_SUMMARY=1 brings the old summary back. */
export function relatedEarlier(text: string, older: Turn[], max = 2): string {
  const w = words(text);
  if (w.size === 0) return "";
  const scored = older
    .map((t) => {
      let n = 0;
      words(t.q).forEach((x) => { if (w.has(x)) n++; });
      return { q: t.q.replace(/\s+/g, " ").trim().slice(0, 90), n };
    })
    .filter((x) => x.n >= 2)
    .sort((a, b) => b.n - a.n)
    .slice(0, max);
  return scored.length ? "سألتَني سابقاً: " + scored.map((x) => x.q).join(" | ") : "";
}

/** The memory to send with a message (facts already include what THIS message states). Null when off or the database is unreachable. */
export async function loadMemory(chatId: number | string, text: string, db: Db = prismaDb, scope?: string, opts: MemoryOpts = {}, profileScope?: string): Promise<MemoryContext | null> {
  if (!shamMemoryEnabled()) return null;
  const key = chatKey(chatId);
  const profileKey = profileScope || key;
  const turnKey = scope || key;      // a named conversation replays its own turns; profile can be model-scoped
  try {
    await ensureTables(db);
    const rows = await db.query<{ question: string; answer: string; created_at?: Date | string | null }>(
      `SELECT question, answer, created_at FROM sham_chat_memory WHERE chat_key=$1 ORDER BY id DESC LIMIT ${WINDOW_TURNS * 4}`, turnKey);
    const prof = await db.query<{ facts: Facts | string; summary: string }>(`SELECT facts, summary FROM sham_user_facts WHERE chat_key=$1`, profileKey);
    const stored = prof[0] ? (typeof prof[0].facts === "string" ? JSON.parse(prof[0].facts) : prof[0].facts) || {} : {};
    // a named conversation is one continuous session however long the pause (that is what "continue the previous chat" means)
    const { current, older } = scope ? { current: rows, older: [] as typeof rows } : currentSession(rows);
    const recent = current.slice(0, WINDOW_TURNS);
    const toTurn = (r: { question: string; answer: string }) => ({ q: r.question, a: r.answer });
    return {
      chatKey: profileKey,
      // 2026-10-17: only the current conversation is replayed as dialogue (a new day no longer continues yesterday's thread); earlier ones come back
      // only when related to this message. REVIEW (2026-10-15): duplicates dropped and (default) only the user's side sent.
      history: cleanHistory(recent.reverse().map(toTurn), Boolean(scope)),
      // "use memory" off: neither the stored facts nor related earlier conversations reach the model (this conversation's own turns still do)
      summary: opts.recall === false ? "" : process.env.SHAM_MEMORY_SUMMARY === "1" ? prof[0]?.summary || "" : relatedEarlier(text, older.map(toTurn)),
      facts: opts.recall === false ? {} : { ...stored, ...extractFacts(text) },
    };
  } catch {
    return null;
  }
}

/** Store one turn, merge new facts, and fold turns that left the window into the rolling summary. */
export async function saveTurn(chatId: number | string, question: string, answer: string, db: Db = prismaDb, scope?: string, opts: MemoryOpts = {}, profileScope?: string): Promise<void> {
  if (!shamMemoryEnabled() || !question.trim() || !answer.trim()) return;
  if (opts.save === false && opts.remember === false) return;
  const key = chatKey(chatId);
  const profileKey = profileScope || key;
  const turnKey = scope || key;
  try {
    await ensureTables(db);
    if (dedupeOn() && opts.save !== false) {   // 2026-10-15: a reply (near-)identical to a recent one is not stored, so it cannot feed the next prompt
      const recent = await db.query<{ answer: string }>(`SELECT answer FROM sham_chat_memory WHERE chat_key=$1 ORDER BY id DESC LIMIT ${WINDOW_TURNS}`, turnKey);
      if (recent.some((r) => nearSameReply(r.answer, answer))) return;
    }
    if (opts.save !== false) await db.exec(`INSERT INTO sham_chat_memory (chat_key, question, answer) VALUES ($1, $2, $3)`, turnKey, question.slice(0, 4000), answer.slice(0, 4000));
    const prof = await db.query<{ facts: Facts | string; summary: string; summarized_upto: string | number }>(
      `SELECT facts, summary, summarized_upto FROM sham_user_facts WHERE chat_key=$1`, profileKey);
    const stored: Facts = prof[0] ? (typeof prof[0].facts === "string" ? JSON.parse(prof[0].facts) : prof[0].facts) || {} : {};
    const facts = opts.remember === false ? stored : { ...stored, ...extractFacts(question) };   // "remember" off: nothing new is learned about the user
    let summary = prof[0]?.summary || "";
    let upto = Number(prof[0]?.summarized_upto || 0);
    // turns older than the window and not yet summarised, once there are SUMMARY_EVERY of them
    const old = scope ? [] : await db.query<{ id: string | number; question: string; answer: string }>(   // a named conversation keeps every turn; profiles stay scoped
      `SELECT id, question, answer FROM sham_chat_memory WHERE chat_key=$1 AND id > $2 ORDER BY id DESC OFFSET ${WINDOW_TURNS}`, profileKey, upto);
    if (old.length >= SUMMARY_EVERY && opts.remember !== false) {
      const leaving = old.reverse();
      summary = foldSummary(summary, leaving.map((r) => ({ q: r.question, a: r.answer })));
      upto = Number(leaving[leaving.length - 1].id);
    }
    await db.exec(
      `INSERT INTO sham_user_facts (chat_key, facts, summary, summarized_upto, updated_at) VALUES ($1, $2::jsonb, $3, $4, now())
       ON CONFLICT (chat_key) DO UPDATE SET facts=EXCLUDED.facts, summary=EXCLUDED.summary, summarized_upto=EXCLUDED.summarized_upto, updated_at=now()`,
      profileKey, JSON.stringify(facts), summary, upto);
  } catch {
    /* memory is best-effort: the reply already went out */
  }
}

/** Forget one model's learned facts without changing the other model's profile; omitting variant clears every profile. */
export async function forgetFacts(chatId: number | string, db: Db = prismaDb, variant?: "v1" | "v2"): Promise<boolean> {
  try {
    await ensureTables(db);
    const key = chatKey(chatId);
    const keys = variant ? [modelMemoryKey(chatId, variant)] : [key, modelMemoryKey(chatId, "v1"), modelMemoryKey(chatId, "v2")];
    for (const profileKey of keys) await db.exec(`DELETE FROM sham_user_facts WHERE chat_key=$1`, profileKey);
    return true;
  } catch { return false; }
}
/** What a selected Sham variant has learned (legacy callers may omit variant). */
export async function shamFacts(chatId: number | string, db: Db = prismaDb, variant?: "v1" | "v2"): Promise<Facts> {
  try {
    await ensureTables(db);
    const key = variant ? modelMemoryKey(chatId, variant) : chatKey(chatId);
    const r = await db.query<{ facts: Facts | string }>(`SELECT facts FROM sham_user_facts WHERE chat_key=$1`, key);
    return r[0] ? (typeof r[0].facts === "string" ? JSON.parse(r[0].facts) : r[0].facts) || {} : {};
  } catch { return {}; }
}

/** «انسَ معلوماتي»: delete this chat's turns, facts and summary. */
export async function forgetMemory(chatId: number | string, db: Db = prismaDb): Promise<boolean> {
  const key = chatKey(chatId);
  try {
    await ensureTables(db);
    await db.exec(`DELETE FROM sham_chat_memory WHERE chat_key=$1 OR chat_key LIKE $2`, key, key + "|%");
    await db.exec(`DELETE FROM sham_user_facts WHERE chat_key=$1 OR chat_key=$2 OR chat_key=$3`, key, modelMemoryKey(chatId, "v1"), modelMemoryKey(chatId, "v2"));
    // the chat list goes too (its turns are gone); the table may not exist yet, which is fine
    try {
      await db.exec(`UPDATE sham_threads SET deleted_at = now() WHERE chat_key=$1 AND deleted_at IS NULL`, key);
      await db.exec(`DELETE FROM sham_thread_active WHERE chat_key=$1`, key);
    } catch { /* no chat list table yet */ }
    return true;
  } catch {
    return false;
  }
}
