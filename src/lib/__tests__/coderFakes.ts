import type { Db } from "@/lib/coderAuth";

/** A small fake of exactly the SQL the coder tables use. */
export function fakeDb(): Db & { t: Record<string, any[]>; state: Map<string, any> } {
  const t: Record<string, any[]> = { prefs: [], tasks: [], events: [], stalls: [], schedules: [], conns: [], memory: [], mems: [], threads: [] };
  let mid0 = 0;
  let clock = Date.parse("2026-10-21T00:00:00Z");
  const ts = () => new Date((clock += 1000)).toISOString();
  const state = new Map<string, any>();
  let eid = 0;
  const db: any = {
    t, state,
    exec: async (sql: string, ...a: any[]) => {
      if (/^(CREATE|ALTER)/i.test(sql.trim())) return;
      // conversation threads (src/lib/coderThreads.ts)
      if (sql.includes("INSERT INTO coder_threads")) return void t.threads.push({ id: a[0], chat_key: a[1], chat_enc: a[2], title: a[3], messages: JSON.parse(a[4]), notes: a[5], conv_id: a[6], legacy: a[7], memory_due: a[8], segments: 0, updated_at: ts(), created_at: ts(), deleted_at: null });
      if (sql.includes("UPDATE coder_threads SET messages = $3")) {
        const x = t.threads.find((r) => r.id === a[0] && r.chat_key === a[1]);
        if (x) Object.assign(x, { messages: JSON.parse(a[2]), notes: a[3], conv_id: a[4], title: x.title || a[5], memory_due: x.memory_due || a[6], updated_at: ts() });
        return;
      }
      if (sql.includes("UPDATE coder_threads SET memory_due = false")) return void Object.assign(t.threads.find((r) => r.id === a[0]) || {}, { memory_due: false });
      if (sql.includes("UPDATE coder_threads SET messages = $2")) return void Object.assign(t.threads.find((r) => r.id === a[0]) || {}, { messages: JSON.parse(a[1]), segments: a[2], summary: a[3] });
      if (sql.includes("coder_chat_state")) return void state.set(a[0], JSON.parse(a[1]));
      if (sql.includes("coder_stall_log")) return void t.stalls.push({ run_id: a[0], pattern: a[3] });
      if (sql.includes("UPDATE coder_memories SET updated_at")) return void Object.assign(t.mems.find((m) => m.chat_key === a[0] && m.id === Number(a[1])) || {}, { updated_at: ts() });
      if (sql.includes("UPDATE coder_memories SET text") && sql.includes("scope = $5")) return void Object.assign(t.mems.find((m) => m.chat_key === a[0] && m.id === Number(a[1])) || {}, { text: a[2], kind: a[3], scope: a[4], updated_at: ts() });
      if (sql.includes("UPDATE coder_memories SET text")) {
        const m = t.mems.find((x) => x.chat_key === a[0] && x.id === Number(a[1]));
        if (m) Object.assign(m, { text: a[2], kind: a[3], source_run: a[4] ?? m.source_run, updated_at: ts() });
        return;
      }
      if (sql.includes("INSERT INTO coder_task_memory")) return void t.memory.push({ run_id: a[0], segment: a[1], chat_key: a[2], summary: a[3] });
      if (sql.includes("INSERT INTO coder_connections")) {
        t.conns = t.conns.filter((c) => !(c.chat_key === a[0] && c.provider === a[1]));
        return void t.conns.push({ chat_key: a[0], provider: a[1], token_enc: a[2], login: a[3] });
      }
      if (sql.includes("DELETE FROM coder_connections")) return void (t.conns = t.conns.filter((c) => !(c.chat_key === a[0] && c.provider === a[1])));
      if (sql.includes("coder_permission_prefs")) {
        t.prefs = t.prefs.filter((r) => !(r.chat_key === a[0] && r.category === a[1] && r.repo === a[2] && r.context === a[3]));
        if (/^INSERT/i.test(sql.trim())) t.prefs.push({ chat_key: a[0], category: a[1], repo: a[2], context: a[3], policy: a[4] });
        return;
      }
      if (sql.includes("INSERT INTO coder_tasks")) return void (t.tasks.find((x) => x.run_id === a[0]) || t.tasks.push({ run_id: a[0], chat_key: a[1], slot: a[2], source: a[3], schedule_id: a[4], title: a[5], status: "running", steps: 0, thread_id: a[6] ?? null }));
      if (sql.includes("UPDATE coder_tasks SET status")) {
        const x = t.tasks.find((r) => r.run_id === a[0]);
        if (x) Object.assign(x, { status: a[1], steps: a[2] ?? x.steps });
        return;
      }
      if (sql.includes("UPDATE coder_tasks")) return;
      if (sql.includes("coder_task_events")) return void t.events.push({ id: ++eid, run_id: a[0], kind: a[1], text: a[2] });
      if (sql.includes("INSERT INTO coder_schedules")) {
        const [id, chat_key, chat_enc, bot_id, title, prompt, kind, cron, tz, repo, events, next_run_at, hook_secret_enc] = a;
        return void t.schedules.push({ id, chat_key, chat_enc, bot_id, title, prompt, kind, cron, tz, repo, events: JSON.parse(events), paused: false, next_run_at, hook_secret_enc, hook_id: null, last_status: null, created_at: new Date().toISOString() });
      }
      if (sql.includes("UPDATE coder_schedules SET paused")) return void Object.assign(t.schedules.find((s) => s.id === a[0]) || {}, { paused: a[1], next_run_at: a[2] });
      if (sql.includes("UPDATE coder_schedules SET last_status")) return void Object.assign(t.schedules.find((s) => s.id === a[0]) || {}, { last_status: a[1] });
      if (sql.includes("UPDATE coder_schedules SET title")) {
        const s = t.schedules.find((x) => x.id === a[0]);
        if (s) Object.assign(s, { title: a[1], prompt: a[2], cron: a[3], tz: a[4], events: JSON.parse(a[5]), next_run_at: s.paused ? s.next_run_at : a[6] });
        return;
      }
      if (sql.includes("UPDATE coder_schedules SET hook_id")) return void Object.assign(t.schedules.find((s) => s.id === a[0]) || {}, { hook_id: a[1] });
      if (sql.includes("DELETE FROM coder_schedules")) return void (t.schedules = t.schedules.filter((s) => !(s.id === a[0] && s.chat_key === a[1])));
    },
    query: async (sql: string, ...a: any[]) => {
      if (sql.includes("UPDATE coder_tasks SET archived_at") && sql.includes("RETURNING run_id")) {   // archiveTask (one finished task)
        const x = t.tasks.find((r) => r.run_id === a[0] && r.chat_key === a[1] && !r.archived && r.status !== "running" && r.status !== "waiting");
        if (x) x.archived = true;
        return x ? [{ run_id: x.run_id }] : [];
      }
      if (sql.includes("INSERT INTO coder_tasks")) {                // taskStart: ON CONFLICT DO NOTHING RETURNING run_id
        if (t.tasks.find((x) => x.run_id === a[0])) return [];
        t.tasks.push({ run_id: a[0], chat_key: a[1], slot: a[2], source: a[3], schedule_id: a[4], title: a[5], status: "running", steps: 0, thread_id: a[6] ?? null });
        return [{ run_id: a[0] }];
      }
      if (sql.includes("SET updated_at = updated_at, deleted_at = NULL")) { const x = t.threads.find((r) => r.id === a[0] && r.chat_key === a[1] && r.deleted_at); if (x) x.deleted_at = null; return x ? [{ id: x.id }] : []; }
      if (sql.includes("UPDATE coder_tasks SET status = 'failed'")) {          // reapStaleTasks: a test marks a task `stale: true` for "started long ago"
        const gone = t.tasks.filter((r) => r.chat_key === a[0] && r.status === "running" && r.stale);
        gone.forEach((r) => { r.status = "failed"; });
        return gone.map((r) => ({ run_id: r.run_id }));
      }
      if (sql.includes("UPDATE coder_tasks SET status = 'stopped'")) { const x = t.tasks.find((r) => r.run_id === a[0] && r.chat_key === a[1] && (r.status === "running" || r.status === "waiting")); if (x) x.status = "stopped"; return x ? [{ run_id: x.run_id }] : []; }
      if (sql.includes("FROM coder_threads t")) return t.threads.filter((r) => !r.deleted_at && r.memory_due).map((r) => ({ ...r, messages: JSON.parse(JSON.stringify(r.messages)) })).slice(0, 1);
      if (sql.includes("FROM coder_threads WHERE id = $1")) return t.threads.filter((r) => r.id === a[0] && r.chat_key === a[1]).map((r) => ({ ...r, messages: JSON.parse(JSON.stringify(r.messages)) }));
      if (sql.includes("FROM coder_threads WHERE chat_key")) return t.threads.filter((r) => r.chat_key === a[0] && !r.deleted_at).slice().reverse().map((r) => ({ ...r, messages_count: r.messages.length }));
      if (sql.includes("UPDATE coder_threads SET title")) { const x = t.threads.find((r) => r.id === a[0] && r.chat_key === a[1]); if (x) x.title = a[2]; return x ? [{ id: x.id }] : []; }
      if (sql.includes("UPDATE coder_threads SET deleted_at")) { const x = t.threads.find((r) => r.id === a[0] && r.chat_key === a[1] && !r.deleted_at); if (x) Object.assign(x, { deleted_at: ts(), memory_due: false }); return x ? [{ id: x.id }] : []; }
      if (sql.includes("FROM coder_chat_state")) return state.has(a[0]) ? [{ state: JSON.parse(JSON.stringify(state.get(a[0]))) }] : [];
      if (sql.includes("FROM coder_permission_prefs")) return t.prefs.filter((r) => r.chat_key === a[0]);
      if (sql.includes("SELECT slot FROM coder_tasks")) return t.tasks.filter((r) => r.run_id === a[0] && r.chat_key === a[1]).map((r) => ({ slot: r.slot }));
      if (sql.includes("FROM coder_connections")) return t.conns.filter((c) => c.chat_key === a[0]);
      if (sql.includes("FROM coder_tasks WHERE")) {
        let rows = t.tasks.filter((r) => r.chat_key === a[0]);
        if (sql.includes("status IN")) rows = rows.filter((r) => r.status === "running" || r.status === "waiting");
        return rows.slice().reverse().map((r) => ({ ...r, started_at: "2026-10-21 00:00:00+00", updated_at: "2026-10-21 00:00:00+00", finished_at: null }));
      }
      if (sql.includes("FROM coder_task_events e")) {
        const own = t.tasks.find((r) => r.run_id === a[0] && r.chat_key === a[1]);
        return own ? t.events.filter((e) => e.run_id === a[0] && e.id > a[2]).map((e) => ({ ...e, created_at: "" })) : [];
      }
      if (sql.includes("coder_stall_log")) return [];
      if (sql.includes("DELETE FROM coder_memories")) {
        const n = t.mems.length;
        t.mems = t.mems.filter((m) => !(m.chat_key === a[0] && m.id === Number(a[1])));
        return n === t.mems.length ? [] : [{ id: a[1] }];
      }
      if (sql.includes("FROM coder_memories WHERE chat_key")) return t.mems.filter((m) => m.chat_key === a[0]).sort((x, y) => (x.updated_at < y.updated_at ? 1 : -1)).map((m) => ({ ...m }));
      if (sql.includes("INSERT INTO coder_memories")) {
        const now = ts();
        const row = { id: ++mid0, chat_key: a[0], scope: a[1], kind: a[2], text: a[3], source_run: a[4], created_at: now, updated_at: now };
        t.mems.push(row);
        return [{ id: row.id }];
      }
      if (sql.includes("FROM coder_schedules WHERE chat_key")) return t.schedules.filter((s) => s.chat_key === a[0]).map((s) => ({ ...s }));
      if (sql.includes("FROM coder_schedules WHERE id")) return t.schedules.filter((s) => s.id === a[0]).map((s) => ({ ...s }));
      if (sql.includes("FROM coder_schedules WHERE kind = 'cron'")) return t.schedules.filter((s) => s.kind === "cron" && !s.paused && s.next_run_at && s.next_run_at <= a[0]).map((s) => ({ ...s }));
      if (sql.includes("UPDATE coder_schedules SET next_run_at")) {
        const s = t.schedules.find((x) => x.id === a[0] && !x.paused && x.next_run_at && x.next_run_at <= a[2]);
        if (!s) return [];
        Object.assign(s, { next_run_at: a[1], last_run_at: a[2] });
        return [{ id: s.id }];
      }
      return [];
    },
  };
  return db;
}

export function fakeBot() {
  const sent: { chat: number; text: string; extra?: any }[] = [];
  let mid = 100;
  const api = {
    sendMessage: jest.fn(async (chat: number, text: string, extra?: any) => { sent.push({ chat, text, extra }); return { message_id: ++mid }; }),
    sendChatAction: jest.fn(async () => ({})),
    answerCallbackQuery: jest.fn(async () => ({})),
    editMessageReplyMarkup: jest.fn(async () => ({})),
    editMessageText: jest.fn(async () => ({})),
    deleteMessage: jest.fn(async () => true),
  };
  return { bot: { api } as any, sent, api };
}
