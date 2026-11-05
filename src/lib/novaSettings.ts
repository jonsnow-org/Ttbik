import { prismaDb, type Db } from "@/lib/coderAuth";

/** Nova-only settings. Never read or write Sham's sham_settings table. */
let tableReady = false;
async function novaSettingsTable(db: Db): Promise<void> {
  if (db === prismaDb && tableReady) return;
  await db.exec(`CREATE TABLE IF NOT EXISTS nova_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  if (db === prismaDb) tableReady = true;
}

export type NovaMediaRouteOrder = "hf_first" | "fallback_first";

export async function novaMediaRouteOrder(db: Db = prismaDb): Promise<NovaMediaRouteOrder> {
  try {
    await novaSettingsTable(db);
    const rows = await db.query<{ value: string }>(`SELECT value FROM nova_settings WHERE key = 'external_media_enabled_v1'`);
    return rows[0]?.value === "enabled" ? "hf_first" : "fallback_first";
  } catch {
    return "fallback_first";
  }
}

export async function setNovaMediaRouteOrder(order: NovaMediaRouteOrder, db: Db = prismaDb): Promise<void> {
  await novaSettingsTable(db);
  const value = order === "hf_first" ? "enabled" : "disabled";
  await db.exec(`INSERT INTO nova_settings (key, value, updated_at) VALUES ('external_media_enabled_v1', $1, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, value);
}
