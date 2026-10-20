import type { Db } from "@/lib/coderAuth";

/** A small fake of exactly the SQL the coder tables use. */
export function fakeDb(): Db & { t: Record<string, any[]>; state: Map<string, any> } {
  const t: Record<string, any[]> = { prefs: [], tasks: [], events: [], stalls: [], schedules: [], conns: [], memory: [] };
  const state = new Map<string, any>();
  let eid = 0;
  const db: any = {
    t, state,
    exec: async (sql: string, ...a: any[]) => {
      if (/^CREATE/i.test(sql.trim())) return;
      if (sql.includes("coder_chat_state")) return void state.set(a[0], JSON.parse(a[1]));
      if (sql.includes("coder_stall_log")) return void t.stalls.push({ run_id: a[0], pattern: a[3] });
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
      if (sql.includes("INSERT INTO coder_tasks")) return void (t.tasks.find((x) => x.run_id === a[0]) || t.tasks.push({ run_id: a[0], chat_key: a[1], slot: a[2], source: a[3], schedule_id: a[4], title: a[5], status: "running", steps: 0 }));
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
  };
  return { bot: { api } as any, sent, api };
}
