// The chat list of Sham and Sham v2 — each has its OWN list (variant "v1" / "v2"), organised like a normal AI app: titles, new chat, open an old chat
// and carry on with its full history, rename, pin, archive, delete (one / many / old / all) and search.
//
// A "thread" is a named stream of turns. Its turns live in `sham_chat_memory` under a scoped key (scopeKey), so they never mix with another chat's or
// with the other Sham's; the user's facts (name, city…) stay per user and are shared by every chat of the same Sham memory. This module imports no
// Nova (coder*) module: the Mini App control plane (coderApp.ts) is the only place that carries a chat from one model to the other.
import { prisma } from "@/lib/prisma";
import { chatKey, ensureTables, loadMemory, saveTurn, scopeKey, type Db, type MemoryContext } from "@/lib/shamMemory";
import { shamModeCtx, shamVariant } from "@/lib/shamStudio";

export type ShamVariantId = "v1" | "v2";
export type ShamThread = { id: string; title: string; pinned: boolean; archived: boolean; turns: number; created_at: string; updated_at: string; preview: string };
export type ShamTurnView = { q: string; a: string; at: string };

const prismaDb: Db = {
  exec: (sql, ...args) => prisma.$executeRawUnsafe(sql, ...args),
  query: <T,>(sql: string, ...args: unknown[]) => prisma.$queryRawUnsafe<T[]>(sql, ...args),
};

const readyBy = new WeakMap<object, Promise<void>>();
export function ensureThreadTables(db: Db): Promise<void> {
  if (db !== prismaDb && !(db as { ddl?: boolean }).ddl) return Promise.resolve();
  let ready = readyBy.get(db) || null;
  if (!ready) {
    ready = (async () => {
      await ensureTables(db);
      await db.exec(`CREATE TABLE IF NOT EXISTS sham_threads (id TEXT PRIMARY KEY, chat_key TEXT NOT NULL, variant TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', preview TEXT NOT NULL DEFAULT '', pinned BOOLEAN NOT NULL DEFAULT false, archived BOOLEAN NOT NULL DEFAULT false, turns INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS sham_threads_chat_idx ON sham_threads (chat_key, variant, updated_at DESC)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS sham_thread_active (chat_key TEXT NOT NULL, variant TEXT NOT NULL, thread_id TEXT NOT NULL, PRIMARY KEY (chat_key, variant))`);
    })().catch((e) => { readyBy.delete(db); throw e; });
    readyBy.set(db, ready);
  }
  return ready;
}

const newId = () => "st_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clip = (s: string, n: number) => String(s || "").replace(/\s+/g, " ").trim().slice(0, n);
const vOf = (v: string): ShamVariantId => (v === "v2" ? "v2" : "v1");
const view = (r: any): ShamThread => ({ id: r.id, title: r.title || "", pinned: Boolean(r.pinned), archived: Boolean(r.archived), turns: Number(r.turns) || 0, created_at: String(r.created_at), updated_at: String(r.updated_at), preview: r.preview || "" });
const COLS = `id, title, preview, pinned, archived, turns, created_at::text AS created_at, updated_at::text AS updated_at`;

async function createThread(chatId: number | string, variant: ShamVariantId, title: string, db: Db): Promise<string> {
  const id = newId();
  await db.exec(`INSERT INTO sham_threads (id, chat_key, variant, title) VALUES ($1, $2, $3, $4)`, id, chatKey(chatId), variant, clip(title, 80));
  await db.exec(`INSERT INTO sham_thread_active (chat_key, variant, thread_id) VALUES ($1, $2, $3) ON CONFLICT (chat_key, variant) DO UPDATE SET thread_id = EXCLUDED.thread_id`, chatKey(chatId), variant, id);
  return id;
}

/** The open chat, if any (reads only). */
export async function currentThreadId(chatId: number | string, variant: ShamVariantId, db: Db = prismaDb): Promise<string | null> {
  await ensureThreadTables(db);
  const a = await db.query<{ thread_id: string }>(
    `SELECT a.thread_id FROM sham_thread_active a JOIN sham_threads t ON t.id = a.thread_id WHERE a.chat_key = $1 AND a.variant = $2 AND t.deleted_at IS NULL`, chatKey(chatId), variant);
  return a[0]?.thread_id || null;
}

/** The chat this user is in now (made on first use). */
export async function activeThreadId(chatId: number | string, variant: ShamVariantId, db: Db = prismaDb): Promise<string> {
  await ensureThreadTables(db);
  const key = chatKey(chatId);
  const a = await db.query<{ thread_id: string }>(
    `SELECT a.thread_id FROM sham_thread_active a JOIN sham_threads t ON t.id = a.thread_id WHERE a.chat_key = $1 AND a.variant = $2 AND t.deleted_at IS NULL`, key, variant);
  if (a[0]) return a[0].thread_id;
  return createThread(chatId, variant, "", db);
}

/** «محادثة جديدة»: opens a fresh chat (an empty one that is already open is reused, so tapping twice does not litter the list). */
export async function newThread(chatId: number | string, variant: ShamVariantId, db: Db = prismaDb, title = ""): Promise<string> {
  await ensureThreadTables(db);
  const cur = await activeThreadId(chatId, variant, db);
  const row = (await db.query<{ turns: number; title: string }>(`SELECT turns, title FROM sham_threads WHERE id = $1`, cur))[0];
  if (row && Number(row.turns) === 0) {
    if (title) await db.exec(`UPDATE sham_threads SET title = $2 WHERE id = $1`, cur, clip(title, 80));
    return cur;
  }
  return createThread(chatId, variant, title, db);
}

/** «تابع المحادثة السابقة»: makes an old chat the open one, history and all. False when it is not this user's chat of this Sham. */
export async function openThread(chatId: number | string, variant: ShamVariantId, id: string, db: Db = prismaDb): Promise<boolean> {
  await ensureThreadTables(db);
  const key = chatKey(chatId);
  const t = await db.query<{ id: string }>(`SELECT id FROM sham_threads WHERE id = $1 AND chat_key = $2 AND variant = $3 AND deleted_at IS NULL`, id, key, variant);
  if (!t[0]) return false;
  await db.exec(`UPDATE sham_threads SET archived = false WHERE id = $1`, id);     // opening an archived chat brings it back
  await db.exec(`INSERT INTO sham_thread_active (chat_key, variant, thread_id) VALUES ($1, $2, $3) ON CONFLICT (chat_key, variant) DO UPDATE SET thread_id = EXCLUDED.thread_id`, key, variant, id);
  return true;
}

export async function listThreads(chatId: number | string, variant: ShamVariantId, o: { q?: string; archived?: "exclude" | "only" | "include"; limit?: number } = {}, db: Db = prismaDb): Promise<ShamThread[]> {
  await ensureThreadTables(db);
  const key = chatKey(chatId);
  const args: unknown[] = [key, variant];
  let extra = "";
  const q = clip(o.q || "", 80);
  if (q) {   // the title, or anything said inside the chat
    args.push(`%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%`);
    extra += ` AND (title ILIKE $${args.length} OR EXISTS (SELECT 1 FROM sham_chat_memory m WHERE m.chat_key = $1 || '|' || $2 || '|' || sham_threads.id AND (m.question ILIKE $${args.length} OR m.answer ILIKE $${args.length})))`;
  }
  extra += ` AND (turns > 0 OR title <> '')`;                           // a new chat nothing was said in is not a list entry yet
  const arch = o.archived || "exclude";
  if (arch === "exclude") extra += ` AND archived = false`; else if (arch === "only") extra += ` AND archived = true`;
  const rows = await db.query<any>(`SELECT ${COLS} FROM sham_threads WHERE chat_key = $1 AND variant = $2 AND deleted_at IS NULL${extra} ORDER BY pinned DESC, updated_at DESC LIMIT ${Math.max(1, Math.min(200, o.limit || 60))}`, ...args);
  return rows.map(view);
}

export async function renameThread(chatId: number | string, variant: ShamVariantId, id: string, title: string, db: Db = prismaDb): Promise<boolean> {
  await ensureThreadTables(db);
  const t = clip(title, 80);
  if (!t) return false;
  return (await db.query<{ id: string }>(`UPDATE sham_threads SET title = $4 WHERE id = $1 AND chat_key = $2 AND variant = $3 AND deleted_at IS NULL RETURNING id`, id, chatKey(chatId), variant, t)).length > 0;
}
export async function pinThread(chatId: number | string, variant: ShamVariantId, id: string, pinned: boolean, db: Db = prismaDb): Promise<boolean> {
  await ensureThreadTables(db);
  return (await db.query<{ id: string }>(`UPDATE sham_threads SET pinned = $4 WHERE id = $1 AND chat_key = $2 AND variant = $3 AND deleted_at IS NULL RETURNING id`, id, chatKey(chatId), variant, pinned)).length > 0;
}
export async function archiveThread(chatId: number | string, variant: ShamVariantId, id: string, archived: boolean, db: Db = prismaDb): Promise<boolean> {
  await ensureThreadTables(db);
  return (await db.query<{ id: string }>(`UPDATE sham_threads SET archived = $4, pinned = CASE WHEN $4 THEN false ELSE pinned END WHERE id = $1 AND chat_key = $2 AND variant = $3 AND deleted_at IS NULL RETURNING id`, id, chatKey(chatId), variant, archived)).length > 0;
}

/** Delete = the chat's turns are really erased (it was about memory of what the user said) and it leaves the list. `ids`; `olderThanDays`; `archived`; or `all`
 *  (pinned chats are kept by the sweeping modes). The open chat survives a sweep unless named in `ids`. Returns the deleted ids. */
export async function deleteThreads(chatId: number | string, variant: ShamVariantId, o: { ids?: string[]; olderThanDays?: number; archived?: boolean; all?: boolean }, db: Db = prismaDb): Promise<string[]> {
  await ensureThreadTables(db);
  const key = chatKey(chatId);
  const open = (await db.query<{ thread_id: string }>(`SELECT thread_id FROM sham_thread_active WHERE chat_key = $1 AND variant = $2`, key, variant))[0]?.thread_id || "";
  let rows: { id: string }[] = [];
  const base = `UPDATE sham_threads SET deleted_at = now() WHERE chat_key = $1 AND variant = $2 AND deleted_at IS NULL`;
  if (o.ids?.length) rows = await db.query(`${base} AND id = ANY($3::text[]) RETURNING id`, key, variant, o.ids.map(String).slice(0, 200));
  else if (Number(o.olderThanDays) > 0) rows = await db.query(`${base} AND pinned = false AND id <> $3 AND updated_at < $4::timestamptz RETURNING id`, key, variant, open, new Date(Date.now() - Number(o.olderThanDays) * 86400000).toISOString());
  else if (o.archived) rows = await db.query(`${base} AND archived = true AND id <> $3 RETURNING id`, key, variant, open);
  else if (o.all) rows = await db.query(`${base} AND pinned = false AND id <> $3 RETURNING id`, key, variant, open);
  for (const r of rows) await db.exec(`DELETE FROM sham_chat_memory WHERE chat_key = $1`, scopeKey(chatId, variant, r.id));
  if (open && rows.some((r) => r.id === open)) await db.exec(`DELETE FROM sham_thread_active WHERE chat_key = $1 AND variant = $2`, key, variant);
  return rows.map((r) => r.id);
}

/** The turns of one chat, oldest first — what the chat page shows when it is opened again. */
export async function threadMessages(chatId: number | string, variant: ShamVariantId, id: string, limit = 200, db: Db = prismaDb): Promise<ShamTurnView[] | null> {
  await ensureThreadTables(db);
  const t = await db.query<{ id: string }>(`SELECT id FROM sham_threads WHERE id = $1 AND chat_key = $2 AND variant = $3 AND deleted_at IS NULL`, id, chatKey(chatId), variant);
  if (!t[0]) return null;
  const rows = await db.query<{ question: string; answer: string; created_at: string }>(
    `SELECT question, answer, created_at::text AS created_at FROM (SELECT id, question, answer, created_at FROM sham_chat_memory WHERE chat_key = $1 ORDER BY id DESC LIMIT ${Math.max(1, Math.min(500, limit))}) x ORDER BY id ASC`, scopeKey(chatId, variant, id));
  return rows.map((r) => ({ q: r.question, a: r.answer, at: r.created_at }));
}

/** After a turn is stored: the chat gets its title (the first thing said), preview and counter. */
async function touch(chatId: number | string, variant: ShamVariantId, id: string, question: string, answer: string, db: Db): Promise<void> {
  await db.exec(
    `UPDATE sham_threads SET turns = turns + 1, updated_at = now(), preview = $2, title = CASE WHEN title = '' THEN $3 ELSE title END WHERE id = $1`,
    id, clip(answer, 120), clip(question, 60));
}

/** Seed a new chat of this Sham with a conversation that happened elsewhere (the model switch): pairs of user/assistant text become its first turns. */
export async function importTranscript(chatId: number | string, variant: ShamVariantId, turns: { role: "user" | "assistant"; text: string }[], title: string, db: Db = prismaDb): Promise<{ id: string; turns: number }> {
  await ensureThreadTables(db);
  const cur = await currentThreadId(chatId, variant, db);
  const empty = cur ? (await db.query<{ turns: number }>(`SELECT turns FROM sham_threads WHERE id = $1`, cur))[0] : undefined;
  const id = cur && empty && Number(empty.turns) === 0 ? cur : await createThread(chatId, variant, title, db);   // an empty open chat is filled, not left behind
  const scope = scopeKey(chatId, variant, id);
  let pending = "", n = 0, last = "", lastA = "";
  const push = async (q: string, a: string) => {
    await db.exec(`INSERT INTO sham_chat_memory (chat_key, question, answer) VALUES ($1, $2, $3)`, scope, q.slice(0, 4000), a.slice(0, 4000));
    n++; last = q; lastA = a;
  };
  for (const t of turns) {
    if (t.role === "user") { if (pending) await push(pending, "…"); pending = t.text; }
    else if (pending) { await push(pending, t.text); pending = ""; }
    else await push("…", t.text);
  }
  if (pending) await push(pending, "…");
  if (n) await db.exec(`UPDATE sham_threads SET turns = $2, preview = $3, title = CASE WHEN title = '' THEN $4 ELSE title END WHERE id = $1`, id, n, clip(lastA, 120), clip(last, 60));
  return { id, turns: n };
}

/** The open chat's turns as a neutral transcript, to hand to another model. */
export async function exportTranscript(chatId: number | string, variant: ShamVariantId, max = 60, db: Db = prismaDb): Promise<{ role: "user" | "assistant"; text: string }[]> {
  const id = await activeThreadId(chatId, variant, db);
  const turns = (await threadMessages(chatId, variant, id, max, db)) || [];
  const out: { role: "user" | "assistant"; text: string }[] = [];
  for (const t of turns) { out.push({ role: "user", text: t.q }); if (t.a && t.a !== "…") out.push({ role: "assistant", text: t.a }); }
  return out;
}

// ---- what the bot calls around a message: the open chat's own turns, falling back to the plain per-user stream when there is no database
const variantNow = (): ShamVariantId => vOf(shamVariant.getStore() || "v1");
export async function loadChatMemory(chatId: number | string, text: string, db: Db = prismaDb): Promise<MemoryContext | null> {
  const variant = variantNow();
  let scope: string | undefined;
  try { scope = scopeKey(chatId, variant, await activeThreadId(chatId, variant, db)); } catch { scope = undefined; }
  return loadMemory(chatId, text, db, scope, shamModeCtx.getStore()?.memory);
}
export async function saveChatTurn(chatId: number | string, question: string, answer: string, db: Db = prismaDb): Promise<void> {
  const variant = variantNow();
  const mem = shamModeCtx.getStore()?.memory;            // this Sham's own switches (remember / recall / save)
  let id = "";
  try { id = mem?.save === false ? (await currentThreadId(chatId, variant, db)) || "" : await activeThreadId(chatId, variant, db); } catch { id = ""; }
  await saveTurn(chatId, question, answer, db, id ? scopeKey(chatId, variant, id) : undefined, mem);
  if (id && mem?.save !== false && question.trim() && answer.trim()) await touch(chatId, variant, id, question, answer, db).catch(() => null);
}
