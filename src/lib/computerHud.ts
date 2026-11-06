// The computer's activity console: the model's own activity (terminal commands, jobs, file writes) shown in a panel
// OUTSIDE and BELOW the screen frame, never drawn over the picture (owner 2026-11-06: nothing is rendered on the screen
// while a task runs; the screen stays a real, touchable desktop). The raw activity feed carries several interchangeable
// text fields and internal counters; this module picks one readable line per event and drops the rest, so the panel stays
// a console rather than a field dump.

export type ActivityItem = { seq?: number; action?: string; detail?: string; text?: string; message?: string; output?: string; id?: string };
export type RunningJob = { id?: string; name?: string; command?: string };

const clean = (value: unknown, max = 220): string => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The last non-empty line of a command's output (the interesting line in a console). */
export function lastOutputLine(output: unknown, max = 220): string {
  const text = String(output ?? "");
  const lines = text.split("\n").map((line) => line.replace(/\s+$/, "")).filter((line) => line.trim());
  return clean(lines[lines.length - 1] || "", max);
}

/** One readable line for one activity event, or "" when the event carries nothing a reader needs. */
export function activityLine(item: ActivityItem | null | undefined): string {
  if (!item || typeof item !== "object") return "";
  const head = clean(item.text || item.message || [item.action, item.detail].filter(Boolean).join(" "));
  const out = lastOutputLine(item.output);
  if (!head) return out ? `→ ${out}` : "";
  return out ? `${head} → ${out}` : head;
}

/**
 * The console: the newest `limit` distinct activity lines, oldest first, plus one line per running background job.
 * Identical consecutive lines are collapsed so a polling feed does not repeat the same row.
 */
export function hudLines(activity: ActivityItem[] | null | undefined, runningJobs: RunningJob[] | null | undefined, limit = 6): string[] {
  const rows: string[] = [];
  for (const item of Array.isArray(activity) ? activity : []) {
    const line = activityLine(item);
    if (!line || rows[rows.length - 1] === line) continue;
    rows.push(line);
  }
  const jobs = (Array.isArray(runningJobs) ? runningJobs : [])
    .map((job) => clean(job?.name || job?.command || job?.id || ""))
    .filter(Boolean)
    .map((name) => `▶ ${name}`);
  return [...rows, ...jobs].slice(-Math.max(1, limit));
}
