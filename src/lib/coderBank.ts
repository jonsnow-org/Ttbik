// The task's read bank (the "episodic bank" idea of Sham's memory plan, for a model whose limit is read speed, not window size).
// Everything a task READS (files, scans, CI logs, pages, search results) is kept here in full, outside the conversation; the conversation window and the segment summaries
// only carry short excerpts. The model asks for a piece back with `recall(query)` instead of reading the same file again (a repeat read costs minutes of CPU).
// Plain lexical ranking over ~1000-character pieces; nothing is decided for the model, it only gets what it asked for.
import { prismaDb, type Db } from "@/lib/coderAuth";
import { terms } from "@/lib/coderWeb";

/** Tools whose result is worth keeping (reads only; never writes, never an error). */
export const BANKABLE = new Set([
  "github_read_file", "github_read_files", "github_repo_scan", "github_list_files", "github_search_code", "github_ci_logs", "github_pr_info", "github_commits", "github_compare",
  "fetch_page", "web_fetch", "web_search", "deep_research", "sandbox_read_file", "sandbox_search", "http_request",
]);
const MAX_ITEMS = 60, MAX_TEXT = 16000;

let ready: Promise<void> | null = null;
function ensureTable(db: Db): Promise<void> {
  if (!ready) {
    ready = db
      .exec(`CREATE TABLE IF NOT EXISTS coder_task_bank (run_id TEXT NOT NULL, seq SERIAL, chat_key TEXT NOT NULL, step INT NOT NULL, tool TEXT NOT NULL, label TEXT NOT NULL, body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (run_id, seq))`)
      .then(() => undefined)
      .catch((e) => { ready = null; throw e; });
  }
  return ready;
}
export const resetBankTable = () => { ready = null; };

export async function bankAdd(runId: string, chatKey: string, step: number, tool: string, label: string, body: string, db: Db = prismaDb): Promise<void> {
  if (!runId || !BANKABLE.has(tool) || !body || /^error\b/i.test(body.trim()) || body.length < 80) return;
  try {
    await ensureTable(db);
    await db.exec(`INSERT INTO coder_task_bank (run_id, chat_key, step, tool, label, body) VALUES ($1, $2, $3, $4, $5, $6)`, runId, chatKey, step, tool, label.slice(0, 240), body.slice(0, MAX_TEXT));
    await db.exec(`DELETE FROM coder_task_bank WHERE run_id = $1 AND seq NOT IN (SELECT seq FROM coder_task_bank WHERE run_id = $1 ORDER BY seq DESC LIMIT ${MAX_ITEMS})`, runId);
  } catch {
    /* best-effort: the bank only saves time */
  }
}

type Row = { step: number; tool: string; label: string; body: string };
/** The best pieces of the kept results for a query: [{label, step, text}] (pure: used by recall and by the tests). */
export function rankBank(rows: Row[], query: string, n = 3, pieceChars = 1000): { label: string; step: number; text: string; score: number }[] {
  const q = terms(query);
  if (!q.length) return [];
  const out: { label: string; step: number; text: string; score: number }[] = [];
  for (const r of rows) {
    const lines = r.body.split("\n");
    let piece: string[] = [], len = 0;
    const flush = () => {
      if (!piece.length) return;
      const text = piece.join("\n");
      const low = text.toLowerCase();
      let s = 0;
      for (const t of q) { const c = low.split(t).length - 1; if (c) s += Math.min(4, c) + (t.length > 5 ? 1 : 0); }
      for (const t of q) if (r.label.toLowerCase().includes(t)) s += 2;
      if (s > 0) out.push({ label: r.label, step: r.step, text, score: s / Math.sqrt(1 + text.length / 800) });
      piece = []; len = 0;
    };
    for (const l of lines) {
      piece.push(l); len += l.length + 1;
      if (len >= pieceChars) flush();
    }
    flush();
  }
  return out.sort((a, b) => b.score - a.score).slice(0, n);
}

/** recall(query): what this task read earlier that matches, as text for the model. */
export async function bankRecall(runId: string, chatKey: string, query: string, n: number, db: Db = prismaDb): Promise<string> {
  const q = String(query || "").trim();
  if (!q) return "error: query is required (what do you want to look up from what you read earlier?)";
  try {
    await ensureTable(db);
    const rows = await db.query<Row>(`SELECT step, tool, label, body FROM coder_task_bank WHERE run_id = $1 AND chat_key = $2 ORDER BY seq DESC LIMIT ${MAX_ITEMS}`, runId, chatKey);
    if (!rows.length) return "nothing has been read in this task yet";
    const hits = rankBank(rows, q, Math.max(1, Math.min(5, n || 3)));
    if (!hits.length) return `nothing in what this task read matches "${q.slice(0, 80)}". Items kept: ${[...new Set(rows.map((r) => r.label))].slice(0, 12).join(" | ")}`;
    return hits.map((h) => `--- from step ${h.step + 1}: ${h.label}\n${h.text}`).join("\n\n").slice(0, 7000);
  } catch {
    return "error: the notes of this task could not be read just now";
  }
}
