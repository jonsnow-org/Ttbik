// Merging the live SSE task feed (src/app/api/coder/stream) into the Mini App's already-loaded task list.
//
// The chat views load a thread once (op "thread") and then follow it. Polling alone made every model feel slow: a
// running answer only appeared on the next poll. The stream endpoint replays durable events from `after`, so the view
// can apply each `text` event the moment it is written and keep polling only as the fallback for a dropped stream.

export type LiveEvent = { id: number; run_id?: string; kind: string; text: string; created_at?: string };
export type TaskLike = { run_id: string; events: LiveEvent[]; [k: string]: unknown };

/** Append `incoming` to the task whose run_id matches, skipping ids already shown. Returns the SAME array when nothing changed
 *  so React can bail out of a re-render, and never mutates the input. */
export function mergeTaskEvents<T extends TaskLike>(tasks: T[], runId: string, incoming: LiveEvent[]): T[] {
  if (!runId || !incoming.length) return tasks;
  const index = tasks.findIndex((t) => t.run_id === runId);
  if (index < 0) return tasks;
  const task = tasks[index];
  const seen = new Set(task.events.map((e) => e.id));
  const fresh = incoming.filter((e) => e && typeof e.id === "number" && !seen.has(e.id));
  if (!fresh.length) return tasks;
  const next = tasks.slice();
  next[index] = { ...task, events: [...task.events, ...fresh].sort((a, b) => a.id - b.id) };
  return next;
}

/** The highest event id already held for a run — the `after` cursor for the next reconnect. 0 when the run is unknown. */
export function lastEventId(tasks: TaskLike[], runId: string): number {
  const task = tasks.find((t) => t.run_id === runId);
  if (!task) return 0;
  return task.events.reduce((max, e) => (e.id > max ? e.id : max), 0);
}

/** Splits a text/event-stream buffer into complete frames, returning the frames and the unconsumed remainder. */
export function splitSseFrames(buffer: string): { frames: string[]; rest: string } {
  const frames: string[] = [];
  let rest = buffer;
  let boundary = rest.indexOf("\n\n");
  while (boundary >= 0) {
    frames.push(rest.slice(0, boundary));
    rest = rest.slice(boundary + 2);
    boundary = rest.indexOf("\n\n");
  }
  return { frames, rest };
}

/** The JSON payload of one SSE frame, or null when the frame is a comment / keep-alive / malformed. */
export function sseFrameData(frame: string): LiveEvent | null {
  const line = frame.split("\n").find((l) => l.startsWith("data:"));
  if (!line) return null;
  try {
    const value = JSON.parse(line.slice(5).trim()) as LiveEvent;
    return value && typeof value.id === "number" ? value : null;
  } catch {
    return null;
  }
}
