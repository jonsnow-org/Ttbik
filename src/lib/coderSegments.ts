// Segment continuation for long coder tasks (owner's order, 2026-10-21): a task never ends because it is long. When the conversation of a
// running task grows past CODER_SEGMENT_CHARS, the agent writes a compact progress summary (goal, plan, done, remaining, key files,
// decisions, next step), the summary is kept in persistent task memory (coder_task_memory + the task's timeline), the context is reset to
// that summary, and the task carries on in a new segment in the background. Results still go to the user's Telegram chat.
import type { CoderMessage } from "@/lib/openCoderStudio";
import { prismaDb, type Db } from "@/lib/coderAuth";

export const SEGMENT_MIN_STEPS = 3;                                     // never compact twice in a row without real work in between
export const segmentChars = () =>
  Math.max(8000, Number(process.env.CODER_SEGMENT_CHARS || Math.floor(Number(process.env.CODER_HISTORY_CHARS || 70000) * 0.75)));

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

/** If the model's summary is unusable, the harness writes one from what it knows (never blocks the task). */
export function fallbackSummary(goal: string, msgs: CoderMessage[], touched: string[], notes: string): string {
  const calls: string[] = [];
  for (const m of msgs) for (const c of ((m as any).tool_calls || []) as any[]) if (c?.function?.name) calls.push(c.function.name);
  const lastText = [...msgs].reverse().find((m) => m.role === "assistant" && (m.content || "").trim())?.content || "";
  return [
    `GOAL:\n${goal.slice(0, 3000) || "(see the request above)"}`,
    `PLAN:\n${notes.slice(-1500) || "(re-plan from the goal)"}`,
    `DONE:\n${calls.length} tool calls so far; recent: ${calls.slice(-15).join(", ") || "none"}`,
    `REMAINING:\nCheck the current state of the files below against the goal and finish what is missing.`,
    `KEY FILES:\n${touched.join("\n") || "(none recorded)"}`,
    `DECISIONS:\n(not recorded)`,
    `NEXT STEP:\n${lastText.slice(-1200) || "Re-read the key files and continue."}`,
  ].join("\n\n");
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
    ].join("\n"),
  }];
}

// ---------------------------------------------------------------- persistent task memory (coder_task_memory, created on first use)
let ready: Promise<void> | null = null;
function ensureTable(db: Db): Promise<void> {
  if (db !== prismaDb) return Promise.resolve();
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
