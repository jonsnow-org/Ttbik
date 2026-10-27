// Segment continuation for long coder tasks (owner's order, 2026-10-21): a task never ends because it is long. When the conversation of a
// running task grows past CODER_SEGMENT_CHARS, the agent writes a compact progress summary (goal, plan, done, remaining, key files,
// decisions, next step), the summary is kept in persistent task memory (coder_task_memory + the task's timeline), the context is reset to
// that summary, and the task carries on in a new segment in the background. Results still go to the user's Telegram chat.
import { segmentCharsFor } from "@/lib/coderContext";
import type { CoderMessage } from "@/lib/openCoderStudio";
import { prismaDb, type Db } from "@/lib/coderAuth";

export const SEGMENT_MIN_STEPS = 3;                                     // never compact twice in a row without real work in between
export const segmentChars = () => segmentCharsFor();

export const msgChars = (msgs: CoderMessage[]) =>
  msgs.reduce((n, m) => n + (m.content || "").length + JSON.stringify((m as { tool_calls?: unknown }).tool_calls || "").length, 0);

export type SegInfo = { segment?: number; segStep?: number; goal?: string };

/** Time for a new segment: the context is large and the task did a few steps since the last one. */
export function needsSegment(msgs: CoderMessage[], run: SegInfo & { step: number }): boolean {
  if (run.step - (run.segStep || 0) < SEGMENT_MIN_STEPS) return false;
  return msgChars(msgs) > segmentChars();
}

export const SUMMARY_SECTIONS = ["GOAL", "PLAN", "DONE", "REMAINING", "KEY FILES", "DECISIONS", "NEXT STEP"] as const;

/** The model call that writes the progress summary (no tools). */
export function summaryRequest(goal: string, segment: number): CoderMessage {
  return {
    role: "user",
    content: [
      `[harness] Context checkpoint (end of segment ${segment}). The task is NOT finished and will continue right after this.`,
      "Write a compact progress summary that a fresh copy of you can continue from with no other context. Use exactly these headings:",
      ...SUMMARY_SECTIONS.map((s) => `${s}:`),
      "Be concrete: repos, branches, file paths, commands, PR/issue numbers, IDs, error messages, what was verified and how. Keep it under 900 words.",
      "Do not call tools and do not address the user; this is internal memory.",
      goal ? `The original request was:\n${goal.slice(0, 3000)}` : "",
    ].filter(Boolean).join("\n"),
  };
}

/** One line for a tool call: its name and the argument that says what it looked at (query, url, repo:path, command). */
function callLine(name: string, argsJson: string): string {
  let a: Record<string, unknown> = {};
  try { a = JSON.parse(argsJson || "{}") || {}; } catch { /* keep empty */ }
  const what = a.query ?? a.question ?? a.url ?? (a.repo ? `${a.repo}${a.path ? `:${a.path}` : ""}` : undefined) ?? a.command ?? a.path ?? a.text ?? a.title;
  return `${name}${what !== undefined ? `: ${String(what).replace(/\s+/g, " ").slice(0, 160)}` : ""}`;
}

/** The facts a tool result carried, shortened: a read page keeps its opening, a search its top lines, a file its head. */
function resultExcerpt(name: string, content: string): string {
  const t = (content || "").replace(/\r/g, "").trim();
  if (!t || /^error|^DENIED|^NOT PERMITTED/i.test(t)) return "";
  const n = /^(fetch_page|web_fetch|deep_research)$/.test(name) ? 700 : /^(web_search|github_search_repos|github_search_code)$/.test(name) ? 450 : /^(github_read_file|sandbox_read_file)$/.test(name) ? 300 : /^(sandbox_exec|sandbox_wait)$/.test(name) ? 500 : 200;
  return t.slice(0, n).replace(/\n{2,}/g, "\n");
}

/**
 * If the model's own summary is unusable, the harness writes one from what happened (never blocks the task). It must carry the FACTS, not
 * just the names of the tools used: a fresh segment that only knows "web_search, fetch_page, …" repeats the same searches from scratch.
 */
export function fallbackSummary(goal: string, msgs: CoderMessage[], touched: string[], notes: string): string {
  const byId = new Map<string, { name: string; line: string }>();
  const done: string[] = [];
  for (const m of msgs) for (const c of ((m as any).tool_calls || []) as any[]) {
    if (!c?.function?.name) continue;
    const line = callLine(c.function.name, c.function.arguments);
    done.push(line);
    if (c.id) byId.set(c.id, { name: c.function.name, line });
  }
  const finds: string[] = [];
  for (const m of msgs) {
    if (m.role !== "tool") continue;
    const meta = byId.get((m as any).tool_call_id || "");
    const ex = resultExcerpt(meta?.name || (m as any).name || "tool", m.content || "");
    if (ex && meta && !/^(load_tools|memory_note|memory_save|memory_search|ask_user)$/.test(meta.name)) finds.push(`• ${meta.line}\n  ${ex.replace(/\n/g, "\n  ")}`);
  }
  const reasoning = msgs.filter((m) => m.role === "assistant" && (m.content || "").trim().length > 80).slice(-3).map((m) => (m.content || "").trim().slice(0, 700));
  const lastText = [...msgs].reverse().find((m) => m.role === "assistant" && (m.content || "").trim())?.content || "";
  // newest findings first matter most; keep the block bounded so the summary stays a summary
  let budget = 6500;
  const kept: string[] = [];
  for (const f of finds.reverse()) { if (f.length > budget) continue; budget -= f.length; kept.push(f); }
  return [
    `GOAL:\n${goal.slice(0, 3000) || "(see the request above)"}`,
    `PLAN:\n${notes.slice(-1500) || "(re-plan from the goal)"}`,
    `DONE:\n(${done.length} tool calls; do NOT repeat these searches/pages, build on what they gave)\n${done.slice(-40).map((d) => `- ${d}`).join("\n") || "none"}`,
    `FINDINGS SO FAR (what the tools returned, newest first):\n${kept.join("\n") || "(nothing useful was returned yet)"}`,
    reasoning.length ? `YOUR OWN CONCLUSIONS SO FAR:\n${reasoning.reverse().join("\n---\n")}` : "",
    `REMAINING:\nCompare what was found with the goal and finish what is missing; when enough is found, STOP searching and write the final answer.`,
    `KEY FILES:\n${touched.join("\n") || "(none recorded)"}`,
    `NEXT STEP:\n${lastText.slice(-1200) || "Use the findings above to continue."}`,
  ].filter(Boolean).join("\n\n");
}

export function usableSummary(text: string): boolean {
  const t = (text || "").trim();
  return t.length >= 80 && SUMMARY_SECTIONS.filter((s) => t.toUpperCase().includes(`${s}:`)).length >= 3;
}

/** The new segment's conversation: the original request plus the summary, nothing else. */
export function segmentMessages(goal: string, summary: string, segment: number): CoderMessage[] {
  return [{
    role: "user",
    content: [
      goal || "(continue the task)",
      "",
      `[harness] This is segment ${segment} of a long task. The earlier context was replaced by this progress summary written at the end of segment ${segment - 1}. Continue the task from NEXT STEP; do not redo work listed under DONE unless you verify it is missing. Re-read files before editing them.`,
      summary.slice(0, 12000),
      "",
      "(Everything you read earlier in this task is kept: recall(query) gives it back; do not read the same file again.)",
    ].join("\n"),
  }];
}

// ---------------------------------------------------------------- persistent task memory (coder_task_memory, created on first use)
let ready: Promise<void> | null = null;
function ensureTable(db: Db): Promise<void> {
  if (db !== prismaDb && !(db as { ddl?: boolean }).ddl) return Promise.resolve();   // `ddl: true` = a real SQL engine in tests
  if (!ready) {
    ready = db
      .exec(`CREATE TABLE IF NOT EXISTS coder_task_memory (run_id TEXT NOT NULL, segment INT NOT NULL, chat_key TEXT NOT NULL, summary TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (run_id, segment))`)
      .then(() => undefined)
      .catch((e) => {
        ready = null;
        throw e;
      });
  }
  return ready;
}

export async function saveSegment(runId: string, segment: number, chatKey: string, summary: string, db: Db = prismaDb): Promise<void> {
  try {
    await ensureTable(db);
    await db.exec(
      `INSERT INTO coder_task_memory (run_id, segment, chat_key, summary) VALUES ($1, $2, $3, $4) ON CONFLICT (run_id, segment) DO UPDATE SET summary = EXCLUDED.summary`,
      runId, segment, chatKey, summary.slice(0, 20000),
    );
  } catch {
    /* best-effort: the summary is also in the task state itself */
  }
}

export async function loadSegments(runId: string, chatKey: string, db: Db = prismaDb): Promise<{ segment: number; summary: string }[]> {
  try {
    await ensureTable(db);
    return await db.query<{ segment: number; summary: string }>(`SELECT segment, summary FROM coder_task_memory WHERE run_id = $1 AND chat_key = $2 ORDER BY segment`, runId, chatKey);
  } catch {
    return [];
  }
}
