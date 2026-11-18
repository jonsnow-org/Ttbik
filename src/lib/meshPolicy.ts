/**
 * The owner's ONE switch for users' devices in the terminal mesh (owner, 2026-11-18): not a per-user opt-in. When on, every user's Mini App
 * joins the mesh of the model that user has selected (src/app/coder-app/_nova/deviceMesh.ts, src/lib/meshNode.ts); when off (the default),
 * every device leaves within one poll. Stored in coder_flags (key mesh_devices), like the T-LDM switch in tldmPolicy.ts.
 */
import { prismaDb, type Db } from "@/lib/coderAuth";

const KEY = "mesh_devices";
const TTL = 15000;
let cache = false;
let at = 0;

export async function meshDevicesOn(db: Db = prismaDb, force = false): Promise<boolean> {
  if (!force && Date.now() - at < TTL) return cache;
  try {
    await db.exec(`CREATE TABLE IF NOT EXISTS coder_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    const rows = await db.query<{ value: string }>(`SELECT value FROM coder_flags WHERE key = $1`, KEY);
    cache = (rows[0]?.value || "").trim() === "1";
  } catch { /* keep the last known value (default off) */ }
  at = Date.now();
  return cache;
}

export async function setMeshDevices(on: boolean, db: Db = prismaDb): Promise<boolean> {
  await db.exec(`CREATE TABLE IF NOT EXISTS coder_flags (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await db.exec(`INSERT INTO coder_flags (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, KEY, on ? "1" : "0");
  cache = Boolean(on);
  at = Date.now();
  return cache;
}

export const _setMeshDevicesForTests = (on: boolean): void => { cache = on; at = Date.now(); };
