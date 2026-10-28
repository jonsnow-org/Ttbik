// Which media engine each Sham model really uses (the owner's panel: «محركات توليد الوسائط»). ONE choice per model, never a global one:
//   Sham v2   — "ready"    : the donor weights in Sham v2's own Studios (image + speech on sham-v2-server, video on sham-v2-video-server)  [default, recommended]
//             — "internal" : Sham v2's own token generator (still training: the quality gate usually refuses its output)
//   Sham (old)— "borrow_v2": uses Sham v2's ready weights for media (what it did before this screen existed)  [default]
//             — "internal" : the old Sham's own original Studio (still training: usually refused by the quality gate)
// Nova is not here: its media always comes from nova-media-server (src/lib/novaMedia.ts). Nothing switches by itself when a call fails.
import { prismaDb, type Db } from "@/lib/shamDb";
import { shamMediaRoute, type ShamMediaRoute } from "@/lib/shamExec";

export type ShamModelId = "sham" | "sham_v2";
export type ShamEngine = "ready" | "internal" | "borrow_v2";
export const SHAM_ENGINE_OPTIONS: Record<ShamModelId, ShamEngine[]> = { sham_v2: ["ready", "internal"], sham: ["borrow_v2", "internal"] };
const KEY: Record<ShamModelId, string> = { sham: "media_engine_v1", sham_v2: "media_engine_v2" };

let ready = false;
async function table(db: Db): Promise<void> {
  if (db === prismaDb && ready) return;
  await db.exec(`CREATE TABLE IF NOT EXISTS sham_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  if (db === prismaDb) ready = true;
}

/** The engine a model uses. Not set yet → what the old single global route would have done for that model (so nothing changes on deploy). */
export async function shamEngine(model: ShamModelId, db: Db = prismaDb): Promise<ShamEngine> {
  try {
    await table(db);
    const rows = await db.query<{ value: string }>(`SELECT value FROM sham_settings WHERE key = $1`, KEY[model]);
    const v = rows[0]?.value as ShamEngine | undefined;
    if (v && SHAM_ENGINE_OPTIONS[model].includes(v)) return v;
  } catch { /* fall through to the default */ }
  const legacy: ShamMediaRoute = await shamMediaRoute(db).catch(() => "sham_v2_ready" as ShamMediaRoute);
  if (model === "sham_v2") return legacy === "sham_v2_internal" ? "internal" : "ready";
  return legacy === "sham_v1" ? "internal" : "borrow_v2";
}

export async function setShamEngine(model: ShamModelId, engine: ShamEngine, db: Db = prismaDb): Promise<void> {
  if (!SHAM_ENGINE_OPTIONS[model]?.includes(engine)) throw new Error("engine not supported for this model");
  await table(db);
  await db.exec(`INSERT INTO sham_settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, KEY[model], engine);
}

/** The route name (kept for logs / messages) for a model on an engine. */
export const routeOf = (model: ShamModelId, engine: ShamEngine): ShamMediaRoute =>
  engine === "internal" ? (model === "sham" ? "sham_v1" : "sham_v2_internal") : "sham_v2_ready";

/** The Studio variant and backend that make the media for this model on this engine. */
export function targetOf(model: ShamModelId, engine: ShamEngine): { route: ShamMediaRoute; variant: "v1" | "v2"; backend: "ready" | "internal" } {
  const route = routeOf(model, engine);
  return { route, variant: route === "sham_v1" ? "v1" : "v2", backend: route === "sham_v2_ready" ? "ready" : "internal" };
}
