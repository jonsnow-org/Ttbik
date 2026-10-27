// A REAL SQL engine for tests: PGlite (PostgreSQL compiled to WASM, in memory) running in a child process (pgWorker.mjs), because Jest's VM cannot load it
// in-process. The chat-list queries use ILIKE, ANY(), JSONB, RETURNING, ON CONFLICT…, which a hand-written fake cannot honestly check.
// `ddl: true` tells the table makers (coderThreads / shamMemory / shamThreads) to create their tables on this handle.
import { spawn } from "child_process";
import path from "path";
import readline from "readline";

export type PgDb = { ddl: true; exec: (sql: string, ...a: unknown[]) => Promise<unknown>; query: <T>(sql: string, ...a: unknown[]) => Promise<T[]>; close: () => void };
const open: PgDb[] = [];
let shared: PgDb | null = null;
/** One engine per test file (the table makers remember they ran); `resetPg()` empties every table between tests. */
export function pgDb(): PgDb {
  if (shared) return shared;
  return (shared = start());
}
export async function resetPg(): Promise<void> {
  if (!shared) return;
  await shared.exec(`DO $$ DECLARE r record; BEGIN FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE'; END LOOP; END $$`);
}
function start(): PgDb {
  const child = spawn(process.execPath, [path.join(__dirname, "pgWorker.mjs")], { stdio: ["pipe", "pipe", "inherit"], cwd: path.join(__dirname, "../../..") });
  const waiting = new Map<number, { ok: (v: { rows: unknown[]; affected: number }) => void; fail: (e: Error) => void }>();
  readline.createInterface({ input: child.stdout! }).on("line", (line) => {
    const m = JSON.parse(line);
    const w = waiting.get(m.id);
    waiting.delete(m.id);
    if (w) (m.error ? w.fail(new Error(m.error)) : w.ok(m));
  });
  let n = 0;
  const send = (sql: string, params: unknown[]) => new Promise<{ rows: unknown[]; affected: number }>((ok, fail) => {
    const id = ++n;
    waiting.set(id, { ok, fail });
    child.stdin!.write(JSON.stringify({ id, sql, params }) + "\n");
  });
  const db: PgDb = {
    ddl: true,
    exec: async (sql, ...a) => (await send(sql, a)).affected,
    query: async <T,>(sql: string, ...a: unknown[]) => (await send(sql, a)).rows as T[],
    close: () => { try { child.kill(); } catch { /* gone */ } },
  };
  open.push(db);
  return db;
}
afterAll(() => { shared = null; for (const d of open.splice(0)) d.close(); });
beforeEach(() => resetPg());
