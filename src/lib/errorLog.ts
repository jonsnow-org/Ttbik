// One place where every server error of the site lands (route and page errors via instrumentation.ts, bot webhook errors, anything that calls reportError()).
// Errors are grouped by a fingerprint, counted, and read by the hourly "error-triage" workflow, which opens one GitHub issue per distinct open error.
// A scheduled Claude session then fixes the open issues without being asked. Never put a secret, a token or a person's data in `message` or `ctx`.
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";

let ready: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS error_reports (fp TEXT PRIMARY KEY, source TEXT NOT NULL, message TEXT NOT NULL, stack TEXT, ctx TEXT, count INT NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'open', note TEXT, first_seen TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen TIMESTAMPTZ NOT NULL DEFAULT now())`);
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}

/** Same bug => same fingerprint: ids, numbers and hex are blanked out of the first line of the message. */
export function fingerprint(source: string, message: string): string {
  const norm = message.split("\n").find((l) => l.trim()) ?? message;
  const flat = norm.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>").replace(/\b[0-9a-f]{16,}\b/gi, "<hex>").replace(/\d+/g, "<n>").slice(0, 200);
  return createHash("sha1").update(`${source}|${flat}`).digest("hex").slice(0, 16);
}

const recent = new Map<string, number>();   // at most one database write per fingerprint per minute
const scrub = (s: string) => s.replace(/\b\d{6,}:[A-Za-z0-9_-]{20,}\b/g, "<token>").replace(/(secret|token|password|key)=[^&\s]+/gi, "$1=<hidden>");

export async function reportError(source: string, err: unknown, ctx: Record<string, string | number | undefined> = {}): Promise<void> {
  try {
    const e = err as { message?: string; stack?: string };
    const message = scrub(String(e?.message ?? err)).slice(0, 600);
    const fp = fingerprint(source, message);
    const now = Date.now();
    if ((recent.get(fp) ?? 0) > now - 60_000) return;
    recent.set(fp, now);
    if (recent.size > 500) recent.clear();
    await ensure();
    await prisma.$executeRawUnsafe(
      `INSERT INTO error_reports (fp, source, message, stack, ctx) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (fp) DO UPDATE SET count = error_reports.count + 1, last_seen = now(), status = CASE WHEN error_reports.status = 'fixed' AND error_reports.last_seen < now() - interval '1 hour' THEN 'open' ELSE error_reports.status END`,
      fp, source.slice(0, 80), message, scrub(String(e?.stack ?? "")).slice(0, 2500), scrub(JSON.stringify(ctx)).slice(0, 600),
    );
  } catch { /* the error log must never break a request (it also cannot write when the database itself is the problem) */ }
}

export type ErrorRow = { fp: string; source: string; message: string; stack: string | null; ctx: string | null; count: number; status: string; note: string | null; first_seen: string; last_seen: string };
export async function listErrors(status = "open", limit = 30): Promise<ErrorRow[]> {
  await ensure();
  return (await prisma.$queryRawUnsafe(`SELECT fp, source, message, stack, ctx, count, status, note, first_seen::text, last_seen::text FROM error_reports WHERE status=$1 ORDER BY last_seen DESC LIMIT $2`, status, limit)) as ErrorRow[];
}
export async function setErrorStatus(fp: string, status: "open" | "fixed" | "ignored", note?: string): Promise<boolean> {
  await ensure();
  const n = await prisma.$executeRawUnsafe(`UPDATE error_reports SET status=$2, note=COALESCE($3, note) WHERE fp=$1`, fp, status, note ?? null);
  return Number(n) > 0;
}
