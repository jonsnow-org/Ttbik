// Conversation threads of the coder (owner's decision, 2026-10-21: separate conversations like Claude / ChatGPT / Mira).
// One row per conversation in coder_threads (created on first use; nothing is ever deleted: "delete" only hides a row with deleted_at).
// The ACTIVE thread's working copy (messages, notes, conv_id) stays in coder_chat_state exactly as before, so the agent loop is
// unchanged; it is written back to its thread row when a reply ends and when the user leaves the thread (new chat / switch).
// Every request (coder_tasks row) carries thread_id, so the Mini App shows a conversation with its requests inside it.
// Rows are keyed by the salted chat hash (coderChatKey); chat_enc is the chat id encrypted (like coder_schedules) so the quiet-time
// work below can save long-term memories for the right user. Old data is never rewritten: a chat that had one rolling conversation
// before threads existed gets one "previous conversation" thread (legacy = true) that also shows its older requests (thread_id NULL).
//
// Quiet-time work (quietWork, called from the scheduler tick): memory extraction and the summary of long threads run only when the
// user has been quiet for CODER_QUIET_MS (default 10 min), has no running request, and the Studio's queue is empty — so they never
// sit in front of a user's next reply.
import { randomUUID } from "crypto";
import { coderChatKey, decryptToken, encryptToken, prismaDb, type Db } from "@/lib/coderAuth";
import type { CoderMessage } from "@/lib/openCoderStudio";

export type ThreadRow = {
  id: string; title: string; created_at: string; updated_at: string; deleted_at: string | null; legacy: boolean; messages_count?: number;
};
type FullRow = ThreadRow & { chat_key: string; chat_enc: string | null; messages: CoderMessage[]; notes: string; conv_id: string | null; memory_due: boolean; segments: number };

export const THREAD_MAX_MESSAGES = () => Math.max(40, Number(process.env.CODER_THREAD_MAX_MESSAGES || 200));
export const quietMs = () => Math.max(60000, Number(process.env.CODER_QUIET_MS || 600000));
export const LEGACY_TITLE = "المحادثة السابقة";

let ready: Promise<void> | null = null;
export function ensureThreadTables(db: Db): Promise<void> {
  if (db !== prismaDb) return Promise.resolve();
  if (!ready) {
    ready = (async () => {
      await db.exec(`CREATE TABLE IF NOT EXISTS coder_threads (id TEXT PRIMARY KEY, chat_key TEXT NOT NULL, chat_enc TEXT, title TEXT NOT NULL DEFAULT '', messages JSONB NOT NULL DEFAULT '[]'::jsonb, notes TEXT NOT NULL DEFAULT '', conv_id TEXT, legacy BOOLEAN NOT NULL DEFAULT false, memory_due BOOLEAN NOT NULL DEFAULT false, memory_at TIMESTAMPTZ, segments INT NOT NULL DEFAULT 0, summary TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS coder_threads_chat_idx ON coder_threads (chat_key, updated_at DESC)`);
      // the request -> conversation link (added column; older rows keep NULL)
      await db.exec(`CREATE TABLE IF NOT EXISTS coder_tasks (run_id TEXT PRIMARY KEY, chat_key TEXT NOT NULL, slot TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'interactive', schedule_id TEXT, title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'running', steps INT NOT NULL DEFAULT 0, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ)`);
      await db.exec(`ALTER TABLE coder_tasks ADD COLUMN IF NOT EXISTS thread_id TEXT`);
      await db.exec(`CREATE INDEX IF NOT EXISTS coder_tasks_thread_idx ON coder_tasks (thread_id, started_at)`);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

const titleOf = (text: string) => String(text || "").replace(/\s+/g, " ").trim().slice(0, 80);
const encChat = (chatId: number | string): string | null => {
  try {
    return encryptToken(String(chatId));
  } catch {
    return null;
  }
};
const parse = <T,>(v: unknown, d: T): T => (typeof v === "string" ? (() => { try { return JSON.parse(v) as T; } catch { return d; } })() : ((v as T) ?? d));
/** The stored copy of a thread's model context: at most THREAD_MAX_MESSAGES, never starting with an orphan tool result. */
export function capMessages(msgs: CoderMessage[], max = THREAD_MAX_MESSAGES()): CoderMessage[] {
  let out = msgs.length > max ? msgs.slice(-max) : msgs.slice();
  while (out.length && out[0].role === "tool") out = out.slice(1);
  return out;
}

/** A new thread row; returns its id. */
export async function createThread(chatId: number | string, o: { title?: string; messages?: CoderMessage[]; notes?: string; convId?: string; legacy?: boolean } = {}, db: Db = prismaDb): Promise<string> {
  const id = randomUUID().replace(/-/g, "").slice(0, 16);
  try {
    await ensureThreadTables(db);
    await db.exec(
      `INSERT INTO coder_threads (id, chat_key, chat_enc, title, messages, notes, conv_id, legacy, memory_due) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
      id, coderChatKey(chatId), encChat(chatId), titleOf(o.title || ""), JSON.stringify(capMessages(o.messages || [])), o.notes || "", o.convId || null, Boolean(o.legacy), Boolean(o.legacy && o.messages?.length),
    );
  } catch {
    /* best-effort: the chat goes on even if the history table is unavailable */
  }
  return id;
}

/** Writes the active working copy back to its thread (end of a reply, or leaving the thread). `memoryDue` = new talk to learn from. */
export async function syncThread(chatKey: string, threadId: string, st: { messages: CoderMessage[]; notes?: string; convId?: string }, db: Db = prismaDb, memoryDue = true): Promise<void> {
  try {
    await ensureThreadTables(db);
    const first = st.messages.find((m) => m.role === "user");
    await db.exec(
      `UPDATE coder_threads SET messages = $3::jsonb, notes = $4, conv_id = $5, title = CASE WHEN title = '' THEN $6 ELSE title END, memory_due = (memory_due OR $7), updated_at = now() WHERE id = $1 AND chat_key = $2`,
      threadId, chatKey, JSON.stringify(capMessages(st.messages)), st.notes || "", st.convId || null, titleOf(String(first?.content || "")), memoryDue,
    );
  } catch {
    /* best-effort */
  }
}

export async function getThread(chatId: number | string, id: string, db: Db = prismaDb): Promise<FullRow | null> {
  try {
    await ensureThreadTables(db);
    const r = (await db.query<any>(
      `SELECT id, chat_key, chat_enc, title, messages, notes, conv_id, legacy, memory_due, segments, created_at::text AS created_at, updated_at::text AS updated_at, deleted_at::text AS deleted_at FROM coder_threads WHERE id = $1 AND chat_key = $2`,
      id, coderChatKey(chatId),
    ))[0];
    return r ? { ...r, messages: parse<CoderMessage[]>(r.messages, []), legacy: Boolean(r.legacy) } : null;
  } catch {
    return null;
  }
}

/** The user's conversations, newest activity first (hidden ones are left out). */
export async function listThreads(chatId: number | string, opts: { limit?: number; before?: string } = {}, db: Db = prismaDb): Promise<ThreadRow[]> {
  try {
    await ensureThreadTables(db);
    const limit = Math.max(1, Math.min(100, opts.limit || 40));
    const args: unknown[] = [coderChatKey(chatId)];
    let extra = "";
    if (opts.before) {
      args.push(opts.before);
      extra = ` AND updated_at < $2::timestamptz`;
    }
    const rows = await db.query<any>(
      `SELECT id, title, legacy, jsonb_array_length(messages) AS messages_count, created_at::text AS created_at, updated_at::text AS updated_at, deleted_at::text AS deleted_at FROM coder_threads WHERE chat_key = $1 AND deleted_at IS NULL${extra} ORDER BY updated_at DESC LIMIT ${limit}`,
      ...args,
    );
    return rows.map((r) => ({ ...r, legacy: Boolean(r.legacy), messages_count: Number(r.messages_count) || 0 }));
  } catch {
    return [];
  }
}

export async function renameThread(chatId: number | string, id: string, title: string, db: Db = prismaDb): Promise<boolean> {
  const t = titleOf(title);
  if (!t) return false;
  try {
    await ensureThreadTables(db);
    const r = await db.query<{ id: string }>(`UPDATE coder_threads SET title = $3 WHERE id = $1 AND chat_key = $2 RETURNING id`, id, coderChatKey(chatId), t);
    return r.length > 0;
  } catch {
    return false;
  }
}

/** "Delete" = hidden from the list; the row (and its requests) stay in the database. */
export async function hideThread(chatId: number | string, id: string, db: Db = prismaDb): Promise<boolean> {
  try {
    await ensureThreadTables(db);
    const r = await db.query<{ id: string }>(`UPDATE coder_threads SET deleted_at = now(), memory_due = false WHERE id = $1 AND chat_key = $2 AND deleted_at IS NULL RETURNING id`, id, coderChatKey(chatId));
    return r.length > 0;
  } catch {
    return false;
  }
}

/** The requests of one thread (the legacy thread also gets the chat's older requests that have no thread). */
export async function threadTasks(chatId: number | string, t: { id: string; legacy: boolean }, db: Db = prismaDb): Promise<{ run_id: string; title: string; status: string; started_at: string; finished_at: string | null }[]> {
  try {
    await ensureThreadTables(db);
    return await db.query<any>(
      `SELECT run_id, title, status, started_at::text AS started_at, finished_at::text AS finished_at FROM coder_tasks WHERE chat_key = $1 AND (thread_id = $2 OR ($3 AND thread_id IS NULL AND slot = '')) ORDER BY started_at ASC LIMIT 200`,
      coderChatKey(chatId), t.id, t.legacy,
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------- quiet-time work (scheduler tick)
type QuietDeps = { status?: () => Promise<Record<string, unknown> | null>; llm?: (m: CoderMessage[]) => Promise<string>; now?: number };

/**
 * One piece of background work per call, only when nobody waits for the model: the Studio queue is empty, the thread's user has been
 * quiet for quietMs() in every thread and has no running request. Long-term memories of a thread first, then the summary of a thread
 * whose context grew past segmentChars (the same summary path as long tasks, coderSegments.ts). Returns what it did.
 */
export async function quietWork(db: Db = prismaDb, deps: QuietDeps = {}): Promise<string> {
  try {
    await ensureThreadTables(db);
    const { coderStatus } = await import("@/lib/openCoderStudio");
    const status = await (deps.status || (() => coderStatus(8000)))().catch(() => null);
    if (!status || Number((status as { queue?: number }).queue || 0) > 0) return "studio busy or down";
    const { segmentChars } = await import("@/lib/coderSegments");
    const quietAt = new Date((deps.now || Date.now()) - quietMs()).toISOString();
    const rows = await db.query<any>(
      `SELECT t.id, t.chat_key, t.chat_enc, t.title, t.messages, t.notes, t.legacy, t.memory_due, t.segments FROM coder_threads t
       WHERE t.deleted_at IS NULL AND t.updated_at < $1::timestamptz AND (t.memory_due OR length(t.messages::text) > $2)
         AND NOT EXISTS (SELECT 1 FROM coder_threads o WHERE o.chat_key = t.chat_key AND o.updated_at >= $1::timestamptz)
         AND NOT EXISTS (SELECT 1 FROM coder_tasks k WHERE k.chat_key = t.chat_key AND k.status IN ('running','waiting') AND k.updated_at >= $1::timestamptz)
       ORDER BY t.memory_due DESC, t.updated_at ASC LIMIT 1`,
      quietAt, segmentChars(),
    );
    const r = rows[0];
    if (!r) return "nothing to do";
    const msgs = parse<CoderMessage[]>(r.messages, []);
    if (r.memory_due) {
      const chatId = r.chat_enc ? decryptToken(String(r.chat_enc)) : null;
      if (chatId && (process.env.CODER_MEMORY || "").toLowerCase() !== "off") {
        const { extractMemories, studioLlm } = await import("@/lib/coderMemory");
        const base = deps.llm || studioLlm(240000, true);
        let answered = false;
        // the model's answer is what counts: a timeout or an empty answer must not mark the thread as learned from (it is retried next tick)
        const llm = async (m: CoderMessage[]) => { const out = await base(m); if (String(out || "").trim()) answered = true; return out; };
        await extractMemories(chatId, msgs.slice(-16), { runId: `thread:${r.id}`, llm }, db).catch(() => null);
        if (!answered) return `memory ${r.id}: the model gave no answer, will retry`;
      }
      await db.exec(`UPDATE coder_threads SET memory_due = false, memory_at = now() WHERE id = $1`, r.id);
      return `memory ${r.id}`;
    }
    return await summarizeThread(r, msgs, db, deps);
  } catch {
    return "error";
  }
}

async function summarizeThread(r: any, msgs: CoderMessage[], db: Db, deps: QuietDeps): Promise<string> {
  const { summaryRequest, segmentMessages, usableSummary, fallbackSummary } = await import("@/lib/coderSegments");
  const { trimMessages } = await import("@/lib/coderAgent");
  const seg = (Number(r.segments) || 0) + 1;
  const goal = String(r.title || msgs.find((m) => m.role === "user")?.content || "").slice(0, 3000);
  let text = "";
  const ask: CoderMessage[] = [{ role: "system", content: "You are the coding agent pausing at a context checkpoint. Write the progress summary you are asked for, nothing else." }, ...trimMessages(msgs), summaryRequest(goal, seg)];
  if (deps.llm) text = await deps.llm(ask).catch(() => "");
  else {
    const { studioLlm } = await import("@/lib/coderMemory");
    text = await studioLlm(40000, true)(ask).catch(() => "");
  }
  const summary = usableSummary(text) ? text.trim() : fallbackSummary(goal, msgs, [], String(r.notes || ""));
  // the summary becomes the start of the context; the last exchanges stay word for word
  const next = [...segmentMessages(goal, summary, seg + 1), ...capMessages(msgs.slice(-4), 4)];
  // the active thread's working copy lives in coder_chat_state: replaced only if the user is still away from it
  const st = (await db.query<{ state: any }>(`SELECT state FROM coder_chat_state WHERE chat_key = $1`, r.chat_key).catch(() => []))[0]?.state;
  const state = typeof st === "string" ? JSON.parse(st) : st;
  if (state && state.threadId === r.id) {
    const last = (m: CoderMessage[]) => JSON.stringify(m[m.length - 1] || null);
    if (state.run || last(state.messages || []) !== last(msgs)) return `skip ${r.id} (changed)`;
    state.messages = next;
    await db.exec(`UPDATE coder_chat_state SET state = $2::jsonb, updated_at = now() WHERE chat_key = $1`, r.chat_key, JSON.stringify(state));
  }
  // updated_at is kept as it was: a summary is not new activity
  await db.exec(`UPDATE coder_threads SET messages = $2::jsonb, segments = $3, summary = $4 WHERE id = $1`, r.id, JSON.stringify(next), seg, summary.slice(0, 20000));
  return `summary ${r.id}`;
}
