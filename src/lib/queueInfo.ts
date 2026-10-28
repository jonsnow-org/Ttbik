/**
 * Where a request stands when the Studios are busy with OTHER people's work (owner 2026-10-28: the terminal never shows "busy"; the user sees a queue position and an
 * estimate). Read from the shared task table, so it is the same on every serverless instance. Neutral module (no model owns it).
 *   ahead    = running tasks of the same model family that started before this one (any user)
 *   position = how many of them must finish before there is a free Studio (ahead - capacity + 1, at least 1 once every Studio is taken)
 *   etaSec   = position x the recent typical duration of that family's finished tasks
 */
import { prismaDb, type Db } from "@/lib/coderAuth";

export type QueueInfo = { ahead: number; position: number; etaSec: number };

export async function queueInfo(runId: string, family: "sham" | "nova", capacity: number, db: Db = prismaDb): Promise<QueueInfo> {
  try {
    const mine = await db.query<{ started_at: string }>(`SELECT started_at::text AS started_at FROM coder_tasks WHERE run_id = $1`, runId);
    if (!mine[0]) return { ahead: 0, position: 0, etaSec: 0 };
    const sham = family === "sham";
    const ahead = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM coder_tasks WHERE status = 'running' AND archived_at IS NULL AND run_id <> $1 AND started_at < $2::timestamptz AND started_at > now() - interval '30 minutes' AND run_id ${sham ? "" : "NOT "}LIKE 'sham-%'`,
      runId, mine[0].started_at,
    );
    const dur = await db.query<{ s: number | null }>(
      `SELECT avg(extract(epoch FROM (finished_at - started_at)))::float AS s FROM (SELECT started_at, finished_at FROM coder_tasks WHERE status = 'done' AND finished_at IS NOT NULL AND run_id ${sham ? "" : "NOT "}LIKE 'sham-%' ORDER BY finished_at DESC LIMIT 20) x`,
    );
    const n = Number(ahead[0]?.n || 0);
    const position = n >= Math.max(1, capacity) ? n - Math.max(1, capacity) + 1 : 0;
    const typical = Math.min(900, Math.max(20, Number(dur[0]?.s) || 60));
    return { ahead: n, position, etaSec: Math.round(position * typical) };
  } catch {
    return { ahead: 0, position: 0, etaSec: 0 };
  }
}

/** The line the user reads (Arabic): never "busy". */
export function queueLine(q: QueueInfo, tries = 0): string {
  if (q.position > 0) {
    const mins = Math.max(1, Math.round(q.etaSec / 60));
    return `⏳ طلبك في الدور — الترتيب ${q.position}، التقدير ~${mins} د. سيبدأ تلقائياً دون أن تعيد إرساله.`;
  }
  return `⏳ طلبك في الدور وسيبدأ تلقائياً حين يتفرّغ خادم${tries > 1 ? ` (محاولة ${tries})` : ""}.`;
}
