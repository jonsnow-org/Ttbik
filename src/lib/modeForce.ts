/**
 * Owner override of the mode (src/lib/modes.ts): the owner can force ONE mode for a whole model (Nova, Sham, Sham v2) for every user, for example "fast" while the Studios
 * are overloaded, or "precise" for a test. A forced model ignores the users' own mode and Auto until the owner clears it. Stored in the same flag table as the pressure switch,
 * cached 20 s per serverless instance. Owner-only in the app (op "mode_force"); it applies to every chat of that model, the owner's included.
 */
import { prismaDb, type Db } from "@/lib/coderAuth";
import { normalizePref, type Pref } from "@/lib/modes";

let cache: Record<string, Pref> = {};
let at = 0;
const TTL = 20000;
let ready = false;

async function table(db: Db): Promise<void> {
  if (db === prismaDb && ready) return;
  await db.exec(`CREATE TABLE IF NOT EXISTS coder_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  if (db === prismaDb) ready = true;
}
const keyOf = (model: string): string => `mode:${model === "coder" || model === "nova" ? "coder" : model}`;

export async function refreshForced(db: Db = prismaDb, force = false): Promise<Record<string, Pref>> {
  if (!force && Date.now() - at < TTL) return cache;
  try {
    await table(db);
    const rows = await db.query<{ key: string; value: string }>(`SELECT key, value FROM coder_flags WHERE key LIKE 'mode:%'`);
    const next: Record<string, Pref> = {};
    for (const r of rows) { const p = normalizePref(r.value); if (p) next[r.key.slice(5)] = p; }
    cache = next;
  } catch { /* keep the last known values */ }
  at = Date.now();
  return cache;
}
/** The forced mode of a model, or undefined. Sync: call refreshForced once at the start of a request. */
export const forcedMode = (model: string | undefined): Pref | undefined => cache[keyOf(model || "coder").slice(5)];
/** pref = a mode to force, or null / "" to clear. */
export async function setForcedMode(model: string, pref: unknown, db: Db = prismaDb): Promise<Pref | undefined> {
  await table(db);
  const p = normalizePref(pref);
  if (p) await db.exec(`INSERT INTO coder_flags (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, keyOf(model), p);
  else await db.exec(`DELETE FROM coder_flags WHERE key = $1`, keyOf(model));
  const next = { ...cache };
  if (p) next[keyOf(model).slice(5)] = p; else delete next[keyOf(model).slice(5)];
  cache = next; at = Date.now();
  return p;
}
export const _setForcedForTests = (v: Record<string, Pref>): void => { cache = v; at = Date.now(); };
