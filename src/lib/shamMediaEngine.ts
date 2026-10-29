// Which media engine each Sham model really uses (the owner's panel: «محركات توليد الوسائط»). ONE choice per model, never a global one:
//   Sham v2   — "ready"    : the donor weights in Sham v2's own Studios (image + speech on sham-v2-server, video on sham-v2-video-server)  [default, recommended]
//             — "internal" : Sham v2's own token generator (still training: the quality gate usually refuses its output)
//   Sham (old)— "internal" : only the old Sham's own original Studio (still training: usually refused by the quality gate).
// Media engines do not cross between Sham v1 and Sham v2. Missing settings use a default owned by that model.
// Nova is not here: its media always comes from nova-media-server (src/lib/novaMedia.ts). Nothing switches by itself when a call fails.
import { prismaDb, type Db } from "@/lib/shamDb";


export type ShamModelId = "sham" | "sham_v2";
export type ShamEngine = "ready" | "internal";
export const SHAM_ENGINE_OPTIONS: Record<ShamModelId, ShamEngine[]> = { sham_v2: ["ready", "internal"], sham: ["internal"] };
const KEY: Record<ShamModelId, string> = { sham: "media_engine_v1", sham_v2: "media_engine_v2" };

let ready = false;
async function table(db: Db): Promise<void> {
  if (db === prismaDb && ready) return;
  await db.exec(`CREATE TABLE IF NOT EXISTS sham_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  if (db === prismaDb) ready = true;
}

/** The engine a model uses. Missing or obsolete choices use only that model's own default route. */
export async function shamEngine(model: ShamModelId, db: Db = prismaDb): Promise<ShamEngine> {
  try {
    await table(db);
    const rows = await db.query<{ value: string }>(`SELECT value FROM sham_settings WHERE key = $1`, KEY[model]);
    const stored = rows[0]?.value;
    if (stored && SHAM_ENGINE_OPTIONS[model].includes(stored as ShamEngine)) return stored as ShamEngine;
  } catch { /* use the selected model's own default below */ }
  return model === "sham_v2" ? "ready" : "internal";
}

export async function setShamEngine(model: ShamModelId, engine: ShamEngine, db: Db = prismaDb): Promise<void> {
  if (!SHAM_ENGINE_OPTIONS[model]?.includes(engine)) throw new Error("engine not supported for this model");
  await table(db);
  await db.exec(`INSERT INTO sham_settings (key, value, updated_at) VALUES ($1, $2, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, KEY[model], engine);
}

/** Resolve only a model-owned route. Invalid model/engine combinations throw instead of crossing boundaries. */
export type ShamMediaRoute = "sham_v1" | "sham_v2_internal" | "sham_v2_ready";
export const routeOf = (model: ShamModelId, engine: ShamEngine): ShamMediaRoute => {
  if (!SHAM_ENGINE_OPTIONS[model].includes(engine)) throw new Error("engine not supported for selected model");
  if (model === "sham") return "sham_v1";
  return engine === "ready" ? "sham_v2_ready" : "sham_v2_internal";
};

/** The Studio variant and backend that make the media for this model on this engine. */
export function targetOf(model: ShamModelId, engine: ShamEngine): { route: ShamMediaRoute; variant: "v1" | "v2"; backend: "ready" | "internal" } {
  const route = routeOf(model, engine);
  return { route, variant: model === "sham" ? "v1" : "v2", backend: model === "sham_v2" && engine === "ready" ? "ready" : "internal" };
}
