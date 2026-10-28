/**
 * Owner-only "pressure mode" (owner 2026-10-28): when the Studios are overloaded the owner flips ONE switch (Mini App → Settings → owner tools) and, until it is switched
 * off, the service sheds load in visible, honest ways:
 *   - media is made smaller (pictures 384 px instead of 512, videos 1 s instead of 2): fewer CPU seconds per request
 *   - the FREE plan's limits are halved (paid plans and the owner are untouched)
 *   - requests wait in a visible queue with position / estimate (never "busy"), and the overflow Studio is tried first (Sham v2), the least-queued Studio first (Nova)
 * Nothing here touches users' devices. The flag lives in the database so every serverless instance agrees (cached 20 s per instance).
 */
import { prismaDb, type Db } from "@/lib/coderAuth";

let on = false;
let at = 0;
const TTL = 20000;
let ready = false;

async function table(db: Db): Promise<void> {
  if (db === prismaDb && ready) return;
  await db.exec(`CREATE TABLE IF NOT EXISTS coder_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  if (db === prismaDb) ready = true;
}

/** Reads the switch (cached): call once at the start of a request; the sync helpers below then use it. */
export async function refreshPressure(db: Db = prismaDb, force = false): Promise<boolean> {
  if (!force && Date.now() - at < TTL) return on;
  try {
    await table(db);
    const r = await db.query<{ value: string }>(`SELECT value FROM coder_flags WHERE key = 'pressure'`);
    on = r[0]?.value === "on";
  } catch { /* keep the last known value */ }
  at = Date.now();
  return on;
}
export async function setPressure(next: boolean, db: Db = prismaDb): Promise<boolean> {
  await table(db);
  await db.exec(`INSERT INTO coder_flags (key, value, updated_at) VALUES ('pressure', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, next ? "on" : "off");
  on = next; at = Date.now();
  return on;
}
export const pressureOn = (): boolean => on;
export const _setPressureForTests = (v: boolean): void => { on = v; at = Date.now(); };

/** Smaller media while the switch is on. */
export const pressureMedia = (): { imageSize: number; videoSeconds: number } => (on ? { imageSize: 384, videoSeconds: 1 } : { imageSize: 512, videoSeconds: 2 });

/** The free plan's limit while the switch is on: half (at least 1 when it was positive); unlimited (-1) and paid plans are untouched. */
export function pressureLimit(limit: number, planId: string): number {
  if (!on || planId !== "free" || limit <= 0) return limit;
  return Math.max(1, Math.floor(limit / 2));
}
