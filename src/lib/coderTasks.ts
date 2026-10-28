// Task history for the coder (owner's plan, 2026-10-21): one row per run in coder_tasks and its steps in coder_task_events.
// The Mini App's live list and history read these; the bot writes them as the agent loop runs (src/lib/coderSections.ts).
// A run lives in a "slot": "" for the chat itself, "s:<scheduleId>" for a scheduled task (its own state, its own fresh step counter).
// Rows are keyed by the salted chat hash; titles/texts are the user's own task text and the bot's visible messages, capped.
import { coderChatKey, decryptToken, encryptToken, prismaDb, type Db } from "@/lib/coderAuth";

export type TaskStatus = "running" | "waiting" | "done" | "failed" | "stopped" | "ceiling" | "limited";
export type TaskSource = "interactive" | "scheduled" | "event" | "agent";
export type EventKind = "start" | "text" | "tool" | "confirm" | "approved" | "declined" | "auto_allowed" | "auto_denied" | "stall" | "segment" | "done" | "failed" | "info";
export type TaskRow = {
  run_id: string; slot: string; source: TaskSource; schedule_id: string | null; title: string; status: TaskStatus;
  steps: number; started_at: string; updated_at: string; finished_at: string | null; thread_id?: string | null;
};
export type EventRow = { id: number; run_id: string; kind: EventKind; text: string; created_at: string };

let ready: Promise<void> | null = null;
export function ensureTaskTables(db: Db): Promise<void> {
  if (db !== prismaDb && !(db as { ddl?: boolean }).ddl) return Promise.resolve();   // `ddl: true` = a real SQL engine in tests
  if (!ready) {
    ready = (async () => {
      await db.exec(`CREATE TABLE IF NOT EXISTS coder_tasks (run_id TEXT PRIMARY KEY, chat_key TEXT NOT NULL, slot TEXT NOT NULL DEFAULT '', source TEXT NOT NULL DEFAULT 'interactive', schedule_id TEXT, title TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'running', steps INT NOT NULL DEFAULT 0, started_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), finished_at TIMESTAMPTZ)`);
      await db.exec(`CREATE INDEX IF NOT EXISTS coder_tasks_chat_idx ON coder_tasks (chat_key, started_at DESC)`);
      await db.exec(`CREATE TABLE IF NOT EXISTS coder_task_events (id BIGSERIAL PRIMARY KEY, run_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await db.exec(`CREATE INDEX IF NOT EXISTS coder_task_events_run_idx ON coder_task_events (run_id, id)`);
      // conversation threads (src/lib/coderThreads.ts): the request's conversation; older rows keep NULL
      await db.exec(`ALTER TABLE coder_tasks ADD COLUMN IF NOT EXISTS thread_id TEXT`);
      await db.exec(`ALTER TABLE coder_tasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
      // who to resume a run for if its server is replaced mid-task (the chat id stays encrypted, like in coder_schedules)
      await db.exec(`ALTER TABLE coder_tasks ADD COLUMN IF NOT EXISTS chat_enc TEXT`);
      await db.exec(`ALTER TABLE coder_tasks ADD COLUMN IF NOT EXISTS bot_id TEXT`);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export async function taskStart(chatId: number | string, t: { runId: string; slot: string; source: TaskSource; scheduleId?: string | null; title: string; threadId?: string | null; botId?: string }, db: Db = prismaDb): Promise<void> {
  try {
    await ensureTaskTables(db);
    // Only a genuinely new task row receives a START event; retries must not duplicate it.
    const inserted = await db.query<{ run_id: string }>(
      `INSERT INTO coder_tasks (run_id, chat_key, slot, source, schedule_id, title, status, thread_id) VALUES ($1, $2, $3, $4, $5, $6, 'running', $7) ON CONFLICT (run_id) DO NOTHING RETURNING run_id`,
      t.runId, coderChatKey(chatId), t.slot, t.source, t.scheduleId || null, t.title.slice(0, 300), t.threadId || null,
    );
    if (inserted.length) {
      if (t.source === "agent") await db.exec(`UPDATE coder_tasks SET archived_at = now() WHERE run_id = $1`, t.runId);   // a sub-agent's task stays out of the user's history
      await db.exec(`INSERT INTO coder_task_events (run_id, kind, text) VALUES ($1, $2, $3)`, t.runId, "start", t.title.slice(0, 2000));
      if (t.botId) await db.exec(`UPDATE coder_tasks SET chat_enc = $2, bot_id = $3 WHERE run_id = $1`, t.runId, encryptToken(String(chatId)), t.botId);
    }
  } catch {
    /* history is best-effort: never blocks the task */
  }
}

export async function archiveFinishedTasks(chatId: number | string, db: Db = prismaDb): Promise<number> {
  await ensureTaskTables(db);
  const key = coderChatKey(chatId);
  const rows = await db.query<{ count: number }>(`SELECT count(*)::int AS count FROM coder_tasks WHERE chat_key = $1 AND archived_at IS NULL AND status NOT IN ('running','waiting')`, key);
  await db.exec(`UPDATE coder_tasks SET archived_at = now(), updated_at = now() WHERE chat_key = $1 AND archived_at IS NULL AND status NOT IN ('running','waiting')`, key);
  return rows[0]?.count || 0;
}

/** Hides ONE finished task from the user's history (a running or waiting one is never touched). Returns whether a row was hidden. */
export async function archiveTask(chatId: number | string, runId: string, db: Db = prismaDb): Promise<boolean> {
  await ensureTaskTables(db);
  const rows = await db.query<{ run_id: string }>(
    `UPDATE coder_tasks SET archived_at = now(), updated_at = now() WHERE run_id = $1 AND chat_key = $2 AND archived_at IS NULL AND status NOT IN ('running','waiting') RETURNING run_id`,
    runId, coderChatKey(chatId),
  );
  return rows.length > 0;
}

export async function taskEvent(runId: string, kind: EventKind, text: string, db: Db = prismaDb): Promise<void> {
  try {
    await ensureTaskTables(db);
    await db.exec(`INSERT INTO coder_task_events (run_id, kind, text) VALUES ($1, $2, $3)`, runId, kind, text.slice(0, 4000));
    await db.exec(`UPDATE coder_tasks SET updated_at = now() WHERE run_id = $1`, runId);
  } catch {
    /* best-effort */
  }
}

/** True when the persisted task row has a recent runner heartbeat; null means the DB check failed or the row is missing. */
export async function taskHeartbeatFresh(runId: string, maxAgeMs = 90000, db: Db = prismaDb): Promise<boolean | null> {
  try {
    await ensureTaskTables(db);
    const rows = await db.query<{ status: string; updated_at: Date | string }>(
      `SELECT status, updated_at FROM coder_tasks WHERE run_id = $1 LIMIT 1`, runId,
    );
    const row = rows[0];
    if (!row) return null;
    if (row.status !== "running") return false;
    const at = row.updated_at instanceof Date ? row.updated_at.getTime() : new Date(row.updated_at).getTime();
    return Number.isFinite(at) && Date.now() - at <= maxAgeMs;
  } catch {
    return null;
  }
}

/** Update liveness without adding a visible log row. */
export async function taskTouch(runId: string, db: Db = prismaDb): Promise<void> {
  try {
    await ensureTaskTables(db);
    await db.exec(`UPDATE coder_tasks SET updated_at = now() WHERE run_id = $1 AND status = $2`, runId, "running");
  } catch { /* best-effort heartbeat */ }
}

/** Close orphaned running rows left behind when a serverless worker was hard-killed. Approval-waiting tasks are intentionally excluded. */
export async function recoverStaleTasks(chatId: number | string, db: Db = prismaDb): Promise<number> {
  try {
    await ensureTaskTables(db);
    const staleMs = Math.max(300000, Number(process.env.CODER_TASK_STALE_MS || 300000));
    const key = coderChatKey(chatId);
    const stale = await db.query<{ run_id: string }>(
      `UPDATE coder_tasks SET status = $3, updated_at = now(), finished_at = now()
       WHERE chat_key = $1 AND archived_at IS NULL AND status = $4
       AND updated_at < now() - ($2::int * interval '1 millisecond')
       RETURNING run_id`, key, staleMs, "failed", "running",
    );
    for (const row of stale) {
      await db.exec(`INSERT INTO coder_task_events (run_id, kind, text) VALUES ($1, $2, $3)`, row.run_id, "failed", "أُغلقت المهمة تلقائياً لأن العامل الخلفي توقف عن إرسال نبضات الحياة.");
    }
    return stale.length;
  } catch { return 0; }
}

export async function taskStatus(runId: string, status: TaskStatus, steps?: number, db: Db = prismaDb): Promise<void> {
  try {
    await ensureTaskTables(db);
    const final = status !== "running" && status !== "waiting";
    await db.exec(
      `UPDATE coder_tasks SET status = $2, steps = COALESCE($3, steps), updated_at = now(), finished_at = CASE WHEN $4 THEN now() ELSE finished_at END WHERE run_id = $1`,
      runId, status, steps ?? null, final,
    );
  } catch {
    /* best-effort */
  }
}

/** The slot a run lives in (for the ✅/❌ callbacks of scheduled runs), or null when unknown. */
export async function taskSlot(runId: string, chatId: number | string, db: Db = prismaDb): Promise<string | null> {
  try {
    await ensureTaskTables(db);
    const rows = await db.query<{ slot: string }>(`SELECT slot FROM coder_tasks WHERE run_id = $1 AND chat_key = $2`, runId, coderChatKey(chatId));
    return rows[0] ? rows[0].slot : null;
  } catch {
    return null;
  }
}

export async function listTasks(chatId: number | string, opts: { limit?: number; before?: string; active?: boolean } = {}, db: Db = prismaDb): Promise<TaskRow[]> {
  try {
    await ensureTaskTables(db);
    // This endpoint is polled frequently by the terminal and must remain read-only.
    // Do not infer a dead worker from a stale task timestamp here: an in-flight model/tool call can
    // outlive a heartbeat write (especially during DB pool pressure), while the runner is still active.
    // Reconciliation belongs to recoverDeadRun(), which can inspect persisted chat state and cancel
    // the Studio job before it marks a task failed.
    const limit = Math.max(1, Math.min(100, opts.limit || 30));
    const where = [`chat_key = $1 AND archived_at IS NULL`];
    const args: unknown[] = [coderChatKey(chatId)];
    if (opts.active) where.push(`status IN ('running','waiting')`);
    if (opts.before) {
      args.push(opts.before);
      where.push(`started_at < $${args.length}::timestamptz`);
    }
    return await db.query<TaskRow>(
      `SELECT run_id, slot, source, schedule_id, title, status, steps, started_at::text AS started_at, updated_at::text AS updated_at, finished_at::text AS finished_at, thread_id FROM coder_tasks WHERE ${where.join(" AND ")} ORDER BY started_at DESC LIMIT ${limit}`,
      ...args,
    );
  } catch {
    return [];
  }
}

export async function taskEvents(chatId: number | string, runId: string, after = 0, db: Db = prismaDb): Promise<EventRow[]> {
  try {
    await ensureTaskTables(db);
    return await db.query<EventRow>(
      `SELECT e.id::int AS id, e.run_id, e.kind, e.text, e.created_at::text AS created_at FROM coder_task_events e JOIN coder_tasks t ON t.run_id = e.run_id WHERE e.run_id = $1 AND t.chat_key = $2 AND t.archived_at IS NULL AND e.id > $3 ORDER BY e.id ASC LIMIT 500`,
      runId, coderChatKey(chatId), after,
    );
  } catch {
    return [];
  }
}

export type OrphanTask = { run_id: string; chatId: number; botId: string; slot: string };

/**
 * Running tasks whose worker stopped beating (the server was replaced or killed mid-leg). Each one is CLAIMED by an atomic UPDATE of its
 * heartbeat, so two ticks (or a tick and a live runner) never resume the same run. A live runner beats every 15 s, so 90 s of silence
 * means it is gone. Tasks that STARTED more than `maxAgeMs` ago are never claimed again (claiming bumped the heartbeat, so a dead run used to look alive for ever: it stayed in "running" for days) and are closed by reapStaleTasks.
 */
export async function claimOrphanTasks(db: Db = prismaDb, staleMs = 90000, maxAgeMs = 30 * 60000): Promise<OrphanTask[]> {
  try {
    await ensureTaskTables(db);
    const rows = await db.query<{ run_id: string; chat_enc: string; bot_id: string; slot: string }>(
      `UPDATE coder_tasks SET updated_at = now() WHERE status = 'running' AND chat_enc IS NOT NULL AND bot_id IS NOT NULL AND updated_at < now() - ($1 || ' milliseconds')::interval AND started_at > now() - ($2 || ' milliseconds')::interval RETURNING run_id, chat_enc, bot_id, slot`,
      String(staleMs), String(maxAgeMs),
    );
    const out: OrphanTask[] = [];
    for (const r of rows) {
      const id = Number(decryptToken(r.chat_enc));
      if (Number.isFinite(id) && id !== 0) out.push({ run_id: r.run_id, chatId: id, botId: r.bot_id, slot: r.slot || "" });
    }
    return out;
  } catch {
    return [];
  }
}

/** Nova tasks that are making progress right now (a recent event). The Oracle updater waits for 0 before it swaps the site container, so a deploy never cuts a running task. */
export async function activeTaskCount(db: Db = prismaDb, freshMs = 90000): Promise<number> {
  try {
    await ensureTaskTables(db);
    const rows = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM coder_tasks WHERE status = 'running' AND updated_at > now() - ($1 || ' milliseconds')::interval`, String(freshMs));
    return Number(rows[0]?.n || 0);
  } catch {
    return 0;       // unknown: never block a deploy
  }
}

/**
 * The lease rule: a running task is alive while its heartbeat (updated_at, bumped by every event and by taskTouch every ~20 s) is fresh. A run whose heartbeat has been silent
 * for 10 minutes (and that is older than 15 minutes, i.e. past the orphan-claim window) is dead and is closed as failed, so the "running now" list never keeps it. Hard caps
 * by START time catch a run that is somehow still beating: Sham 45 minutes, anything else 6 hours. Waiting runs (a question or approval for the user) are left alone.
 * The orphan claim no longer re-bumps a run that started over 30 minutes ago: that bump used to make dead runs look alive for days.
 */
export async function reapStaleTasks(chatId: number | string, db: Db = prismaDb): Promise<number> {
  try {
    await ensureTaskTables(db);
    const rows = await db.query<{ run_id: string }>(
      `UPDATE coder_tasks SET status = 'failed', updated_at = now(), finished_at = now()
       WHERE chat_key = $1 AND archived_at IS NULL AND status = 'running'
       AND ((updated_at < now() - interval '10 minutes' AND started_at < now() - interval '15 minutes')
         OR (run_id LIKE 'sham-%' AND started_at < now() - interval '45 minutes')
         OR started_at < now() - interval '6 hours')
       RETURNING run_id`,
      coderChatKey(chatId),
    );
    for (const r of rows) await db.exec(`INSERT INTO coder_task_events (run_id, kind, text) VALUES ($1, $2, $3)`, r.run_id, "failed", "أُغلقت المهمة تلقائياً: انتهت مدتها دون نتيجة.");
    return rows.length;
  } catch { return 0; }
}

/** Marks one running / waiting task as stopped in the history (the live Studio job of a Nova run is cancelled by stopRun first). */
export async function stopTaskRow(chatId: number | string, runId: string, db: Db = prismaDb): Promise<boolean> {
  try {
    await ensureTaskTables(db);
    const r = await db.query<{ run_id: string }>(
      `UPDATE coder_tasks SET status = 'stopped', updated_at = now(), finished_at = now() WHERE run_id = $1 AND chat_key = $2 AND status IN ('running','waiting') RETURNING run_id`,
      runId, coderChatKey(chatId),
    );
    return r.length > 0;
  } catch { return false; }
}
