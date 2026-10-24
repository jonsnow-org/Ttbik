// "Lessons": every finished, successful run of the OWNER (research with its sources, tool use with its results, plain chat) is kept as one
// clean training example, so the work Nova does can teach another model (Sham) how to search, use tools and write reports. Stored in
// coder_lessons (created on first use). Conservative on privacy: owner's chats only, never other users'; a run that shows any secret-looking
// text is not kept at all (the whole run, not a patched copy); tool results are shortened; the system prompt is never kept.
// Export format (one JSON object per line): {"kind","run","steps","messages":[{role,content,tool_calls?,tool_call_id?,name?}]}.
// CODER_LESSONS=off stops recording. Nothing leaves the database by itself: publishing to a trainer is the owner's decision.
import { prismaDb, type Db } from "@/lib/coderAuth";
import type { CoderMessage } from "@/lib/openCoderStudio";

const SECRET_RX = /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|(?:token|secret|password|passwd|api[_-]?key|مفتاح|كلمة السر)\s*[:=]\s*\S{8,}|\b[A-Fa-f0-9]{40,}\b|[A-Za-z0-9+/]{60,}={0,2}|\b\d{8,10}:[A-Za-z0-9_-]{30,}\b)/i;

// Tool results are public web pages / repository text: commit hashes, long URLs and base64-looking blobs are normal there, so only the high-confidence token shapes count for them.
const HIGH_RX = /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gho_[A-Za-z0-9]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.|\b\d{8,10}:[A-Za-z0-9_-]{30,}\b)/;

export type Lesson = { kind: "research" | "tools" | "chat"; run: string; steps: number; messages: CoderMessage[] };

/** The lesson of a finished run, or null when it should not be kept. Pure: the caller decides who and when. */
export function buildLesson(runId: string, steps: number, msgs: CoderMessage[]): Lesson | null {
  const kept: CoderMessage[] = [];
  let usedTools = false;
  let research = false;
  for (const m of msgs) {
    if (m.role === "system") continue;
    const content = String((m as { content?: string }).content ?? "");
    if (content.startsWith("[harness]") && m.role === "user") continue;                     // the engine's own nudges are not part of the lesson
    const calls = (m as { tool_calls?: { function?: { name?: string; arguments?: string } }[] }).tool_calls;
    const blob = content + JSON.stringify(calls || []);
    if ((m.role === "tool" ? HIGH_RX : SECRET_RX).test(blob)) return null;
    if (calls?.length) {
      usedTools = true;
      if (calls.some((c) => /^(deep_research|web_search|fetch_page|web_fetch)$/.test(c.function?.name || ""))) research = true;
    }
    kept.push(m.role === "tool" ? ({ ...m, content: content.slice(0, 1500) } as CoderMessage) : m);
  }
  const last = [...kept].reverse().find((m) => m.role === "assistant" && String((m as { content?: string }).content || "").trim());
  if (!last || String((last as { content: string }).content).trim().length < 80) return null;
  if (!kept.some((m) => m.role === "user")) return null;
  return { kind: research ? "research" : usedTools ? "tools" : "chat", run: runId, steps, messages: kept };
}

let ready: Promise<void> | null = null;
function ensureTable(db: Db): Promise<void> {
  if (db !== prismaDb) return db.exec(`CREATE TABLE IF NOT EXISTS coder_lessons (run_id TEXT PRIMARY KEY, kind TEXT NOT NULL, steps INT NOT NULL DEFAULT 0, messages JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`).then(() => undefined);
  if (!ready) {
    ready = db.exec(`CREATE TABLE IF NOT EXISTS coder_lessons (run_id TEXT PRIMARY KEY, kind TEXT NOT NULL, steps INT NOT NULL DEFAULT 0, messages JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`).then(() => undefined).catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

/** "saved", or why not: "off" | "not kept (secret-looking text, no final answer or no request)" | "database: …". Shown to the owner in the task log. */
export async function recordLessonStatus(runId: string, steps: number, msgs: CoderMessage[], db: Db = prismaDb): Promise<string> {
  if ((process.env.CODER_LESSONS || "").toLowerCase() === "off") return "off";
  const l = buildLesson(runId, steps, msgs);
  if (!l) return "not kept (secret-looking text, no final answer or no request)";
  try {
    await ensureTable(db);
    await db.exec(`INSERT INTO coder_lessons (run_id, kind, steps, messages) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (run_id) DO NOTHING`, l.run, l.kind, l.steps, JSON.stringify(l.messages));
    return "saved";
  } catch (e) {
    return `database: ${String((e as Error)?.message || e).slice(0, 120)}`;
  }
}
export async function recordLesson(runId: string, steps: number, msgs: CoderMessage[], db: Db = prismaDb): Promise<boolean> {
  return (await recordLessonStatus(runId, steps, msgs, db)) === "saved";
}

export async function lessonStats(db: Db = prismaDb): Promise<{ total: number; byKind: Record<string, number> }> {
  try {
    await ensureTable(db);
    const rows = await db.query<{ kind: string; n: number }>(`SELECT kind, count(*)::int AS n FROM coder_lessons GROUP BY kind`);
    const byKind: Record<string, number> = {};
    for (const r of rows) byKind[r.kind] = r.n;
    return { total: Object.values(byKind).reduce((a, b) => a + b, 0), byKind };
  } catch {
    return { total: 0, byKind: {} };
  }
}

/** JSON Lines of the newest lessons (bounded), for the owner to take or publish. */
export async function exportLessons(db: Db = prismaDb, limit = 200, maxBytes = 900_000): Promise<{ jsonl: string; count: number }> {
  try {
    await ensureTable(db);
    const rows = await db.query<{ run_id: string; kind: string; steps: number; messages: unknown }>(`SELECT run_id, kind, steps, messages FROM coder_lessons ORDER BY created_at DESC LIMIT $1`, Math.min(2000, Math.max(1, limit)));
    const lines: string[] = [];
    let bytes = 0;
    for (const r of rows) {
      const line = JSON.stringify({ kind: r.kind, run: r.run_id, steps: r.steps, messages: typeof r.messages === "string" ? JSON.parse(r.messages) : r.messages });
      if (bytes + line.length > maxBytes) break;
      bytes += line.length + 1;
      lines.push(line);
    }
    return { jsonl: lines.join("\n"), count: lines.length };
  } catch {
    return { jsonl: "", count: 0 };
  }
}

export async function clearLessons(db: Db = prismaDb): Promise<void> {
  try {
    await ensureTable(db);
    await db.exec(`DELETE FROM coder_lessons`);
  } catch { /* nothing to clear */ }
}
