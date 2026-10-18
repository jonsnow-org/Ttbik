// The ZNBt / platform configuration that the pages read from /zenobia/znbt/config.json. A committed base (src/lib/znbtBase.json: the master address)
// merged with a small override kept in the database, so launch day needs no deploy:
//  - `curve` and `launchedAt` are found by themselves: the index cron spots the owner's own launch (fixed salt) on the chain;
//  - `open` (other people may launch coins) is switched by the owner from the «🌐 الاستضافة» panel's coin-platform buttons.
import { Address } from "@ton/core";
import { prisma } from "@/lib/prisma";
import base from "./znbtBase.json";

export const OWNER_WALLET = "UQBt3hzFFJ11GjBjzD523m3NnyhqRNyfKCmzVq9_zVfjQJSz";
export const ZNBT_SALT = "1000001";
/** ZNBt's jetton minter (read from the chain after the owner's launch of 2026-10-18, verified by znbt-verify): a fixed on-chain fact, so the passport and the hall can count ZNBt without any command. */
export const ZNBT_MINTER = "EQAbVrwm8FAEVLyN9qxPCMc084CsQ3CWn07Azi8MU6PqdKIr";   // the salt the owner's launch page uses (contracts/zenobia-curve/web/src/launch.ts)

export type ZnbtConfig = { master: string; curve: string; open: boolean; launchedAt: string };
export const BASE = base as ZnbtConfig;

let ready: Promise<void> | null = null;
function ensure(): Promise<void> {
  if (!ready) ready = prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS znbt_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`).then(() => undefined).catch((e) => { ready = null; throw e; });
  return ready;
}

/** Only these keys can be overridden; the master address never can. */
export function mergeConfig(b: ZnbtConfig, o: Partial<ZnbtConfig> | null): ZnbtConfig {
  const out = { ...b };
  if (o) {
    if (typeof o.curve === "string" && /^[A-Za-z0-9_\-]{48}$/.test(o.curve)) out.curve = o.curve;
    if (typeof o.open === "boolean") out.open = o.open;
    if (typeof o.launchedAt === "string" && !Number.isNaN(Date.parse(o.launchedAt))) out.launchedAt = o.launchedAt;
  }
  return out;
}

export async function readOverride(): Promise<Partial<ZnbtConfig>> {
  try {
    await ensure();
    const rows = (await prisma.$queryRawUnsafe(`SELECT value FROM znbt_config WHERE key='override'`)) as { value: string }[];
    return rows[0] ? (JSON.parse(rows[0].value) as Partial<ZnbtConfig>) : {};
  } catch { return {}; }
}
export async function getConfig(): Promise<ZnbtConfig> { return mergeConfig(BASE, await readOverride()); }

export async function patchOverride(patch: Partial<ZnbtConfig>): Promise<ZnbtConfig> {
  await ensure();
  const next = { ...(await readOverride()), ...patch };
  await prisma.$executeRawUnsafe(`INSERT INTO znbt_config (key, value) VALUES ('override',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()`, JSON.stringify(next));
  return mergeConfig(BASE, next);
}

/** The owner's own ZNBt launch among the indexed coins (same creator wallet, the fixed salt), or null. */
export function findZnbt(coins: { curve: string; creator: string; salt: string; createdAt: number }[]): { curve: string; launchedAt: string } | null {
  const owner = Address.parse(OWNER_WALLET);
  for (const c of coins) {
    if (c.salt !== ZNBT_SALT) continue;
    try { if (!Address.parse(c.creator).equals(owner)) continue; } catch { continue; }
    return { curve: Address.parse(c.curve).toString({ bounceable: true, urlSafe: true }), launchedAt: new Date(c.createdAt * 1000).toISOString() };
  }
  return null;
}
/** Called after each index refresh: remembers ZNBt's address and launch time once, with no human step. */
export async function adoptZnbt(coins: Parameters<typeof findZnbt>[0]): Promise<boolean> {
  const z = findZnbt(coins);
  if (!z) return false;
  const cur = await readOverride();
  if (cur.curve === z.curve && cur.launchedAt === z.launchedAt) return false;
  await patchOverride(z);
  return true;
}
