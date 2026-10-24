// Loop / stall detection for the coder's agent loop (owner's order, 2026-10-21: finish the task without stopping — no user-facing pause).
// The harness watches what the model does; when it repeats itself it is NOT stopped: it gets a reflection step, a fresh look at the files
// it was working on, a new plan and a different strategy, and the loop goes on. Every detected stall is logged (coder_stall_log) so the
// root causes can be fixed. The only stop is a hard ceiling against runaway compute (CODER_HARD_MAX_STEPS, default 400) that counts model
// steps since the last REAL progress, not total steps: a long task that keeps doing new things never reaches it (see coderSegments.ts).
import { createHash } from "crypto";
import type { CoderToolCall } from "@/lib/openCoderStudio";
import { prismaDb, type Db } from "@/lib/coderAuth";

export const STALL_REPEAT = Math.max(2, Number(process.env.CODER_STALL_REPEAT || 3));          // same action+args this many times = stall
export const STALL_NO_PROGRESS = Math.max(4, Number(process.env.CODER_STALL_NO_PROGRESS || 12)); // steps without anything new = stall
export const HARD_MAX_STEPS = Math.max(50, Number(process.env.CODER_HARD_MAX_STEPS || 400));    // runaway-compute ceiling (model steps without real progress)
const WINDOW = 12;

export type StallPattern = "repeat_call" | "repeat_output" | "repeat_error" | "no_progress" | "repeat_text" | "hard_ceiling";
export type Stall = { pattern: StallPattern; detail: string };
export type StallState = {
  gen?: number;            // file writes so far (see RERUNNABLE)
  calls: { sig: string; res: string; err: boolean }[];
  texts: string[];
  seen: string[];          // every distinct action+args of this task
  progressStep: number;    // last model step that did something new (also moved by a recovery, for the no_progress window)
  realStep?: number;       // last model step with REAL progress (a new successful action or a changed CI result); recoveries never move it
  level: number;           // stalls so far in this task (recovery escalates with it)
  touched: string[];       // repo:path the task read or wrote (re-read on recovery)
  counts: Record<string, number>;   // how often each action+args ran in this task
  outs: Record<string, string>;     // its last result (short), returned instead of running it yet again
};
export const newStallState = (): StallState => ({ calls: [], texts: [], seen: [], progressStep: 0, level: 0, touched: [], counts: {}, outs: {} });

// tools whose output legitimately stays the same while something else runs (CI): repeating them is waiting, not looping
export const POLL_TOOLS = new Set(["github_ci_status", "github_list_prs", "github_list_issues", "github_list_branches", "sandbox_wait"]);
const RUNNING_RX = /\b(in_progress|queued|pending|waiting|requested)\b/i;

const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as any)[k])])) : v;
export function callSig(call: CoderToolCall): string {
  let args: unknown = call.function.arguments;
  try {
    args = canon(JSON.parse(call.function.arguments || "{}"));
  } catch {
    /* keep the raw text */
  }
  return `${call.function.name}:${createHash("sha1").update(JSON.stringify(args)).digest("hex").slice(0, 16)}`;
}
export function outSig(out: string): string {
  return createHash("sha1").update((out || "").replace(/\s+/g, " ").trim().slice(0, 4000)).digest("hex").slice(0, 16);
}
const isError = (out: string) => /^(error|HTTP [45]\d\d)/i.test((out || "").trim());

/** Before running a call: an identical (non-polling) call already made STALL_REPEAT times is not run again — its earlier result is returned. */
// Running the same command/test again after changing files is progress, not a loop: these calls are told apart by the number of
// file writes made so far in the task.
export const RERUNNABLE = new Set(["sandbox_exec", "sandbox_read_file", "github_read_file"]);
const WRITES = new Set(["sandbox_write_file", "github_write_files", "github_delete_files", "sandbox_clone"]);
function sigOf(ss: StallState, call: CoderToolCall): string {
  const base = callSig(call);
  return RERUNNABLE.has(call.function.name) ? `${base}@${ss.gen || 0}` : base;
}

export function beforeCall(ss: StallState, call: CoderToolCall): { skip: string } | null {
  if (POLL_TOOLS.has(call.function.name)) return null;
  const sig = sigOf(ss, call);
  const n = ss.counts[sig] || 0;
  if (n >= STALL_REPEAT) {
    ss.counts[sig] = n + 1;
    const prev = ss.outs[sig] || "";
    return { skip: `[harness] Not run again: this exact call (${call.function.name} with the same arguments) was already made ${n} times. Its result was:\n${prev.slice(0, 1500)}\nUse a different approach.` };
  }
  return null;
}

/** After a call ran: record it; returns a stall when the task is going in circles, and whether to wait before the next step (CI still running). */
export function afterCall(ss: StallState, call: CoderToolCall, out: string, step: number): { stall: Stall | null; wait: boolean } {
  const sig = sigOf(ss, call);
  if (WRITES.has(call.function.name) && !isError(out)) ss.gen = (ss.gen || 0) + 1;
  const res = outSig(out);
  const err = isError(out);
  const poll = POLL_TOOLS.has(call.function.name);
  const prevSame = ss.calls.filter((c) => c.sig === sig);
  const wait = poll && RUNNING_RX.test(out) && prevSame.some((c) => c.res === res);
  ss.calls = [...ss.calls, { sig, res, err }].slice(-WINDOW);
  ss.counts[sig] = (ss.counts[sig] || 0) + 1;
  ss.outs[sig] = out.slice(0, 1500);
  const keys = Object.keys(ss.outs);
  if (keys.length > 40) for (const k of keys.slice(0, keys.length - 40)) delete ss.outs[k];
  const key = poll ? `${sig}=${res}` : sig;           // a poll is progress when its result changed (CI moved on)
  if (!ss.seen.includes(key) && !err) {
    ss.seen = [...ss.seen, key].slice(-500);
    ss.progressStep = step;
    ss.realStep = step;
  }
  try {
    const a = JSON.parse(call.function.arguments || "{}");
    const paths = [a.path, ...(Array.isArray(a.files) ? a.files.map((f: any) => f?.path) : [])].filter(Boolean);
    for (const p of paths) if (a.repo) ss.touched = [...ss.touched.filter((t) => t !== `${a.repo}:${p}`), `${a.repo}:${p}`].slice(-8);
  } catch {
    /* no args */
  }
  const tail = ss.calls.slice(-STALL_REPEAT);
  let stall: Stall | null = null;
  if (!poll && prevSame.length + 1 >= STALL_REPEAT) stall = { pattern: "repeat_call", detail: `${call.function.name} same args ×${prevSame.length + 1}` };
  else if (tail.length === STALL_REPEAT && tail.every((c) => c.err && c.res === res)) stall = { pattern: "repeat_error", detail: `same error ×${STALL_REPEAT}: ${out.slice(0, 160)}` };
  else if (!poll && tail.length === STALL_REPEAT && tail.every((c) => c.res === res)) stall = { pattern: "repeat_output", detail: `same output ×${STALL_REPEAT} (${call.function.name})` };
  else if (step - ss.progressStep >= STALL_NO_PROGRESS) stall = { pattern: "no_progress", detail: `${step - ss.progressStep} steps without a new action or result` };
  if (stall) {
    ss.level++;
    ss.calls = [];                // fresh window after recovery
    ss.progressStep = step;
  }
  return { stall, wait };
}

/** Model steps since the last real progress: what the hard ceiling counts. */
export const stepsSinceProgress = (ss: StallState | undefined, step: number) => step - (ss?.realStep || 0);

/** After a model step that asked for tools: the same reasoning text again and again is a loop too. */
export function afterText(ss: StallState, text: string, step: number): Stall | null {
  const t = (text || "").replace(/\s+/g, " ").trim();
  if (t.length < 40) return null;
  const sig = outSig(t);
  const n = ss.texts.filter((x) => x === sig).length;
  ss.texts = [...ss.texts, sig].slice(-WINDOW);
  if (n + 1 >= STALL_REPEAT) {
    ss.level++;
    ss.texts = [];
    ss.progressStep = step;
    return { pattern: "repeat_text", detail: `same reasoning text ×${n + 1}` };
  }
  return null;
}

/** The recovery step injected into the conversation (escalates with ss.level). `fresh` = the touched files re-read now. */
export function recoveryMessage(stall: Stall, ss: StallState, fresh: string): string {
  const lines = [
    `[harness] Loop detected (${stall.pattern}: ${stall.detail}). You are repeating yourself without progress.`,
    "Before the next action, reflect in 3 short points: what you tried, why it did not work, what is actually blocking. Write in the language of the original request, not English.",
    "Then write a NEW numbered plan that uses a different strategy (different tool, different file, smaller step, or read the error/source first), save it with memory_note, and continue the task. Do not repeat the same call with the same arguments.",
  ];
  if (ss.level >= 2) lines.push("This is not the first loop in this task: re-check your assumptions against the real files below and the original request.");
  if (ss.level >= 3) lines.push("Start the plan from scratch from the original request; ignore the earlier plan. If a step truly cannot be done, finish the rest and report that step honestly.");
  if (fresh) lines.push(`Fresh copies of the files you were working on:\n${fresh}`);
  return lines.join("\n");
}

/** Recovery knobs for the next model call: think harder and sample wider after repeated loops. */
export function recoveryKnobs(ss: StallState): { think: boolean; temperature: number } {
  return ss.level >= 2 ? { think: true, temperature: Math.min(1.0, Math.round((0.6 + 0.15 * (ss.level - 1)) * 100) / 100) } : { think: false, temperature: 0.6 };
}

// ---------------------------------------------------------------- persistent log (coder_stall_log, created on first use)
let ready: Promise<void> | null = null;
function ensureTable(db: Db): Promise<void> {
  if (db !== prismaDb) return Promise.resolve();
  if (!ready) {
    ready = (async () => {
      await db.exec(`CREATE TABLE IF NOT EXISTS coder_stall_log (id BIGSERIAL PRIMARY KEY, run_id TEXT NOT NULL, chat_key TEXT NOT NULL, step INT NOT NULL, pattern TEXT NOT NULL, level INT NOT NULL, detail TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
      await db.exec(`CREATE INDEX IF NOT EXISTS coder_stall_log_created_idx ON coder_stall_log (created_at DESC)`);
    })().catch((e) => {
      ready = null;
      throw e;
    });
  }
  return ready;
}

export type StallLogRow = { run_id: string; chat_key: string; step: number; pattern: string; level: number; detail: string; created_at?: string };

export async function logStall(row: StallLogRow, db: Db = prismaDb): Promise<void> {
  console.warn(`[coder-stall] run=${row.run_id} step=${row.step} pattern=${row.pattern} level=${row.level} ${row.detail.slice(0, 200)}`);
  try {
    await ensureTable(db);
    await db.exec(`INSERT INTO coder_stall_log (run_id, chat_key, step, pattern, level, detail) VALUES ($1, $2, $3, $4, $5, $6)`,
      row.run_id, row.chat_key, row.step, row.pattern, row.level, row.detail.slice(0, 2000));
  } catch {
    /* best-effort: logging never blocks the task */
  }
}

export async function recentStalls(limit = 15, db: Db = prismaDb): Promise<StallLogRow[]> {
  try {
    await ensureTable(db);
    return await db.query<StallLogRow>(`SELECT run_id, chat_key, step, pattern, level, detail, created_at FROM coder_stall_log ORDER BY id DESC LIMIT $1`, limit);
  } catch {
    return [];
  }
}
